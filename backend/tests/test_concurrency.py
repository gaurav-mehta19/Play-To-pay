import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed

from django.test import Client, TestCase, TransactionTestCase

from payouts.models import LedgerEntry, Merchant
from payouts import repository


class ConcurrentPayoutTest(TransactionTestCase):
    """
    Two simultaneous payout requests each for 8000 paise against a 10000 paise balance.
    Exactly one must succeed; the other must be rejected with insufficient funds.
    No overdraft may occur.

    TransactionTestCase is required: each thread needs its own DB connection and
    real COMMIT semantics so select_for_update contention actually happens.
    """

    def setUp(self):
        self.merchant = Merchant.objects.create(name='Concurrent Test Merchant')
        LedgerEntry.objects.create(
            merchant=self.merchant,
            amount_paise=10_000,
            entry_type='credit',
        )

    def _make_request(self, _):
        client = Client()
        return client.post(
            '/api/v1/payouts/',
            data={
                'merchant_id': str(self.merchant.id),
                'amount_paise': 8_000,
                'bank_account_id': 'bank_test_001',
            },
            content_type='application/json',
            HTTP_IDEMPOTENCY_KEY=str(uuid.uuid4()),
        )

    def test_concurrent_payouts_only_one_succeeds(self):
        results = []

        with ThreadPoolExecutor(max_workers=2) as executor:
            futures = [executor.submit(self._make_request, i) for i in range(2)]
            for future in as_completed(futures):
                results.append(future.result().status_code)

        successes = results.count(201)
        failures = results.count(400)

        self.assertEqual(successes, 1, f"Expected 1 success, got {successes}. Results: {results}")
        self.assertEqual(failures, 1, f"Expected 1 failure, got {failures}. Results: {results}")

        # Balance invariant: no overdraft
        balance = repository.compute_balance(self.merchant.id)
        self.assertGreaterEqual(
            balance['available_paise'], 0,
            f"Overdraft detected: available_paise={balance['available_paise']}"
        )
        self.assertEqual(
            balance['held_paise'], 8_000,
            f"Expected 8000 paise held, got {balance['held_paise']}"
        )
