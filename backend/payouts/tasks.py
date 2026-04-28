import logging

from celery import shared_task

from . import service

logger = logging.getLogger(__name__)


@shared_task(bind=True, max_retries=3, name='payouts.tasks.process_payout')
def process_payout(self, payout_id):
    try:
        service.process_payout(payout_id)
    except Exception as exc:
        logger.exception("process_payout failed for %s: %s", payout_id, exc)
        raise self.retry(exc=exc, countdown=5 * (2 ** self.request.retries))


@shared_task(name='payouts.tasks.detect_stuck_payouts')
def detect_stuck_payouts():
    try:
        service.handle_stuck_payouts()
    except Exception:
        logger.exception("detect_stuck_payouts encountered an error")
