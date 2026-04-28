import json
import uuid

from django.test import Client, TestCase

from payouts.models import LedgerEntry, Merchant, Payout


class IdempotencyTest(TestCase):
    def setUp(self):
        self.merchant = Merchant.objects.create(name='Idempotency Test Merchant')
        LedgerEntry.objects.create(
            merchant=self.merchant,
            amount_paise=100_000,
            entry_type='credit',
        )
        self.client = Client()
        self.idempotency_key = str(uuid.uuid4())

    def _post_payout(self):
        return self.client.post(
            '/api/v1/payouts/',
            data={
                'merchant_id': str(self.merchant.id),
                'amount_paise': 10_000,
                'bank_account_id': 'bank_idem_001',
            },
            content_type='application/json',
            HTTP_IDEMPOTENCY_KEY=self.idempotency_key,
        )

    def test_idempotency_key_deduplicates(self):
        response1 = self._post_payout()
        response2 = self._post_payout()

        self.assertEqual(response1.status_code, 201)
        self.assertEqual(response2.status_code, 201)

        # Both responses must be byte-identical.
        self.assertEqual(
            response1.content,
            response2.content,
            "Idempotent responses must be byte-identical",
        )

        # Only 1 payout row in the DB.
        payout_count = Payout.objects.filter(merchant=self.merchant).count()
        self.assertEqual(payout_count, 1, f"Expected 1 payout, found {payout_count}")

        # Only 1 hold ledger entry for that payout.
        payout = Payout.objects.get(merchant=self.merchant)
        hold_count = LedgerEntry.objects.filter(
            merchant=self.merchant,
            entry_type='hold',
            reference_id=payout.id,
        ).count()
        self.assertEqual(hold_count, 1, f"Expected 1 hold entry, found {hold_count}")
