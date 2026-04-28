import json
import logging
import random
from datetime import timedelta

from django.db import transaction
from django.utils import timezone

from . import repository

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# State machine
# ---------------------------------------------------------------------------

VALID_TRANSITIONS = {
    'pending': ['processing'],
    'processing': ['completed', 'failed'],
}


class InvalidStateTransitionError(Exception):
    pass


class InsufficientFundsError(Exception):
    pass


class MerchantNotFoundError(Exception):
    pass


def _apply_transition(payout, new_status):
    allowed = VALID_TRANSITIONS.get(payout.status, [])
    if new_status not in allowed:
        raise InvalidStateTransitionError(
            f"Cannot transition payout {payout.id} from '{payout.status}' to '{new_status}'"
        )
    payout.status = new_status


# ---------------------------------------------------------------------------
# Payout creation
# ---------------------------------------------------------------------------

def create_payout(merchant_id, amount_paise, bank_account_id, idempotency_key):
    """
    Full payout creation flow with idempotency guard and overdraft protection.
    Returns (response_dict, http_status_code).
    """
    # 1. Check existing idempotency record (read before any write).
    existing = repository.get_idempotency_record(merchant_id, idempotency_key)
    if existing and existing.response_body is not None:
        return existing.response_body, existing.status_code

    # 2. Insert placeholder — real race guard.
    idem_record, created = repository.create_idempotency_record_placeholder(merchant_id, idempotency_key)

    if not created:
        # Another request already owns this key.
        # If it finished, return its response. If still in-flight return 409.
        if idem_record.response_body is not None:
            return idem_record.response_body, idem_record.status_code
        return {'error': 'Request with this idempotency key is already being processed'}, 409

    # 3. Core transaction: lock merchant, check balance, create payout + hold.
    try:
        with transaction.atomic():
            try:
                merchant = repository.get_merchant_for_update(merchant_id)
            except Exception:
                raise MerchantNotFoundError(f"Merchant {merchant_id} not found")

            balance = repository.compute_balance(merchant_id)

            if amount_paise > balance['available_paise']:
                error_response = {
                    'error': 'Insufficient funds',
                    'available_paise': balance['available_paise'],
                    'requested_paise': amount_paise,
                }
                repository.update_idempotency_record(idem_record.id, error_response, 400)
                return error_response, 400

            payout = repository.create_payout(merchant_id, amount_paise, idempotency_key)
            repository.create_ledger_entry(merchant_id, amount_paise, 'hold', reference_id=payout.id)

            from .serializers import PayoutSerializer
            payout_data = PayoutSerializer(payout).data
            response_body = json.dumps(dict(payout_data))
            repository.update_idempotency_record(idem_record.id, response_body, 201)

            # Enqueue only after the transaction commits to avoid phantom tasks.
            transaction.on_commit(lambda: _enqueue_process_payout(payout.id))

        return response_body, 201

    except MerchantNotFoundError:
        error_response = {'error': f'Merchant {merchant_id} not found'}
        repository.update_idempotency_record(idem_record.id, error_response, 404)
        return error_response, 404


def _enqueue_process_payout(payout_id):
    try:
        from .tasks import process_payout
        process_payout.delay(str(payout_id))
    except Exception:
        # Broker unavailable — stuck-payout detector will re-enqueue pending payouts.
        logger.warning("Could not enqueue payout %s; stuck-payout detector will retry", payout_id)


# ---------------------------------------------------------------------------
# Payout processing (called from Celery worker)
# ---------------------------------------------------------------------------

def process_payout(payout_id):
    try:
        repository.get_payout(payout_id)
    except Exception:
        logger.error("Payout %s not found, skipping", payout_id)
        return

    # Lock payout and guard against double-processing.
    with transaction.atomic():
        try:
            payout = repository.get_payout_for_update(payout_id)
        except Exception:
            logger.error("Payout %s disappeared under lock, skipping", payout_id)
            return

        if payout.status != 'pending':
            logger.info("Payout %s is already %s, skipping", payout_id, payout.status)
            return

        _apply_transition(payout, 'processing')
        payout.attempt_count += 1
        payout.last_attempted_at = timezone.now()
        repository.save_payout(payout)
    # Commit processing transition before simulating the bank call.

    outcome = random.random()

    if outcome < 0.70:
        _complete_payout(payout_id)
    elif outcome < 0.90:
        _fail_payout(payout_id)
    # else: hang — stuck payout detector will handle it


def _complete_payout(payout_id):
    with transaction.atomic():
        payout = repository.get_payout_for_update(payout_id)
        if payout.status != 'processing':
            logger.info("Payout %s is %s, skipping complete", payout_id, payout.status)
            return
        _apply_transition(payout, 'completed')
        repository.create_ledger_entry(
            payout.merchant_id, payout.amount_paise, 'debit', reference_id=payout.id
        )
        repository.save_payout(payout)
    logger.info("Payout %s completed", payout_id)


def _fail_payout(payout_id):
    with transaction.atomic():
        payout = repository.get_payout_for_update(payout_id)
        if payout.status != 'processing':
            logger.info("Payout %s is %s, skipping fail", payout_id, payout.status)
            return
        _apply_transition(payout, 'failed')
        repository.create_ledger_entry(
            payout.merchant_id, payout.amount_paise, 'release', reference_id=payout.id
        )
        repository.save_payout(payout)
    logger.info("Payout %s failed, funds released", payout_id)


# ---------------------------------------------------------------------------
# Stuck payout detector (called from Celery Beat)
# ---------------------------------------------------------------------------

def handle_stuck_payouts():
    threshold = timezone.now() - timedelta(seconds=30)
    stuck_ids = repository.get_stuck_payout_ids(threshold)

    for payout_id in stuck_ids:
        _handle_single_stuck_payout(payout_id)


def _handle_single_stuck_payout(payout_id):
    with transaction.atomic():
        try:
            payout = repository.get_payout_for_update(payout_id)
        except Exception:
            return

        if payout.status != 'processing':
            return

        if payout.attempt_count >= 3:
            _apply_transition(payout, 'failed')
            repository.create_ledger_entry(
                payout.merchant_id, payout.amount_paise, 'release', reference_id=payout.id
            )
            repository.save_payout(payout)
            logger.info("Payout %s exceeded max retries, marked failed", payout_id)
        else:
            # Reset to pending so process_payout can reprocess it.
            payout.status = 'pending'
            repository.save_payout(payout)

            def _re_enqueue():
                from .tasks import process_payout as task
                task.delay(str(payout_id))

            transaction.on_commit(_re_enqueue)
            logger.info("Payout %s re-enqueued (attempt %d)", payout_id, payout.attempt_count)


# ---------------------------------------------------------------------------
# Balance read
# ---------------------------------------------------------------------------

def get_balance(merchant_id):
    with transaction.atomic():
        repository.get_merchant(merchant_id)  # raises if not found
        return repository.compute_balance(merchant_id)
