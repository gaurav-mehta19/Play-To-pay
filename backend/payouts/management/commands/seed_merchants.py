from django.core.management.base import BaseCommand

from payouts.models import LedgerEntry, Merchant

SEED_DATA = [
    {'name': 'Acme Corp', 'credits_paise': 1_000_000},   # ₹10,000
    {'name': 'Globex Inc', 'credits_paise': 500_000},     # ₹5,000
    {'name': 'Initech Ltd', 'credits_paise': 2_500_000},  # ₹25,000
]


class Command(BaseCommand):
    help = 'Seed 3 merchants with initial credit history'

    def handle(self, *args, **options):
        for entry in SEED_DATA:
            merchant, created = Merchant.objects.get_or_create(name=entry['name'])

            if created:
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
            else:
                self.stdout.write(f"Merchant '{merchant.name}' already exists, skipping")
