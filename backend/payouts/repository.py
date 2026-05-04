from datetime import timedelta

from django.db import IntegrityError
from django.db.models import BigIntegerField, Case, Sum, Value, When
from django.utils import timezone

from .models import IdempotencyRecord, LedgerEntry, Merchant, Payout


def get_merchant(merchant_id):
    return Merchant.objects.get(id=merchant_id)


def get_merchant_for_update(merchant_id):
    """Lock merchant row for the duration of the current transaction."""
    return Merchant.objects.select_for_update().get(id=merchant_id)


def compute_balance(merchant_id):
    """
    Aggregate balance from ledger entries inside the caller's transaction.

    available = credits - holds + releases
    held      = holds - releases - debits
    """
    result = LedgerEntry.objects.filter(merchant_id=merchant_id).aggregate(
        credits=Sum(
            Case(
                When(entry_type='credit', then='amount_paise'),
                default=Value(0),
                output_field=BigIntegerField(),
            )
        ),
        holds=Sum(
            Case(
                When(entry_type='hold', then='amount_paise'),
                default=Value(0),
                output_field=BigIntegerField(),
            )
        ),
        debits=Sum(
            Case(
                When(entry_type='debit', then='amount_paise'),
                default=Value(0),
                output_field=BigIntegerField(),
            )
        ),
        releases=Sum(
            Case(
                When(entry_type='release', then='amount_paise'),
                default=Value(0),
                output_field=BigIntegerField(),
            )
        ),
    )

    credits = result['credits'] or 0
    holds = result['holds'] or 0
    debits = result['debits'] or 0
    releases = result['releases'] or 0

    available = credits - holds + releases
    held = holds - releases - debits

    return {'available_paise': available, 'held_paise': held}


def get_idempotency_record(merchant_id, key):
    cutoff = timezone.now() - timedelta(hours=24)
    try:
        return IdempotencyRecord.objects.get(
            merchant_id=merchant_id,
            key=key,
            created_at__gt=cutoff,
        )
    except IdempotencyRecord.DoesNotExist:
        return None


def create_idempotency_record_placeholder(merchant_id, key):
    """
    Insert a placeholder record. Returns (record, created).
    Caller must catch IntegrityError if two requests race.
    """
    try:
        record, created = IdempotencyRecord.objects.get_or_create(
            merchant_id=merchant_id,
            key=key,
            defaults={'response_body': None, 'status_code': None},
        )
        return record, created
    except IntegrityError:
        # Two concurrent requests passed the get_or_create check simultaneously.
        # Fetch and return the winner's record.
        record = IdempotencyRecord.objects.get(merchant_id=merchant_id, key=key)
        return record, False


def update_idempotency_record(record_id, response_body, status_code):
    IdempotencyRecord.objects.filter(id=record_id).update(
        response_body=response_body,
        status_code=status_code,
    )


def create_payout(merchant_id, amount_paise, idempotency_key):
    return Payout.objects.create(
        merchant_id=merchant_id,
        amount_paise=amount_paise,
        status='pending',
        idempotency_key=idempotency_key,
    )


def create_ledger_entry(merchant_id, amount_paise, entry_type, reference_id=None):
    return LedgerEntry.objects.create(
        merchant_id=merchant_id,
        amount_paise=amount_paise,
        entry_type=entry_type,
        reference_id=reference_id,
    )


def get_payout(payout_id):
    return Payout.objects.get(id=payout_id)


def get_payout_for_update(payout_id):
    return Payout.objects.select_for_update().get(id=payout_id)


def save_payout(payout):
    payout.save()


def get_payouts_for_merchant(merchant_id):
    return Payout.objects.filter(merchant_id=merchant_id).order_by('-created_at')


def get_ledger_for_merchant(merchant_id):
    return LedgerEntry.objects.filter(merchant_id=merchant_id).order_by('-created_at')


def get_all_merchants():
    return Merchant.objects.all().order_by('name')


def get_stuck_payout_ids(threshold):
    return list(
        Payout.objects.filter(
            status='processing',
            last_attempted_at__lt=threshold,
        ).values_list('id', flat=True)
    )


def get_stuck_pending_payout_ids(threshold):
    return list(
        Payout.objects.filter(
            status='pending',
            created_at__lt=threshold,
        ).values_list('id', flat=True)
    )
