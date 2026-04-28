from django.core.management.base import BaseCommand

from payouts.models import IdempotencyRecord, LedgerEntry, Merchant, Payout

SEED_DATA = [
    {'name': 'Acme Corp', 'credits_paise': 1_000_000},   # ₹10,000
    {'name': 'Globex Inc', 'credits_paise': 500_000},     # ₹5,000
    {'name': 'Initech Ltd', 'credits_paise': 2_500_000},  # ₹25,000
]


class Command(BaseCommand):
    help = 'Seed merchants with initial credit history. Prompts before overwriting existing data.'

    def handle(self, *args, **options):
        if Merchant.objects.exists():
            try:
                confirm = input(
                    'Data already exists. Delete all merchants, payouts, and ledger entries and re-seed? [y/N] '
                )
            except EOFError:
                # Non-interactive environment (e.g. Docker) — keep existing data.
                self.stdout.write('Non-interactive mode: data already exists, skipping seed.')
                return
            if confirm.strip().lower() != 'y':
                self.stdout.write('Aborted.')
                return

            IdempotencyRecord.objects.all().delete()
            Payout.objects.all().delete()
            LedgerEntry.objects.all().delete()
            Merchant.objects.all().delete()
            self.stdout.write(self.style.WARNING('Flushed all data'))

        for entry in SEED_DATA:
            merchant = Merchant.objects.create(name=entry['name'])
            LedgerEntry.objects.create(
                merchant=merchant,
                amount_paise=entry['credits_paise'],
                entry_type='credit',
                reference_id=None,
            )
            self.stdout.write(
                self.style.SUCCESS(
                    f"Created {merchant.name} with {entry['credits_paise']} paise credit"
                )
            )
