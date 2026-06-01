"""Provision per-party ledger accounts from the inventory master.

Thin wrapper over core.party_ledgers.provision_all_party_ledgers: creates a
ledger for every supplier and every non-retail (B2B / Hospital / Clinic / …)
customer, idempotently. This also runs automatically on every `sync_all`, so the
command is mainly for first-time / on-demand provisioning.

  ./manage.py provision_party_ledgers              # suppliers + customers
  ./manage.py provision_party_ledgers --suppliers  # suppliers only
  ./manage.py provision_party_ledgers --customers  # customers only
"""
from django.core.management.base import BaseCommand

from core.party_ledgers import provision_all_party_ledgers


class Command(BaseCommand):
    help = 'Create per-party ledgers for all suppliers and non-retail customers.'

    def add_arguments(self, parser):
        parser.add_argument('--suppliers', action='store_true', help='Suppliers only.')
        parser.add_argument('--customers', action='store_true', help='Customers only.')

    def handle(self, *args, **opts):
        only_s, only_c = opts['suppliers'], opts['customers']
        both = not (only_s or only_c)
        res = provision_all_party_ledgers(
            suppliers=only_s or both,
            customers=only_c or both,
        )
        self.stdout.write(self.style.SUCCESS(
            f"Party ledgers created — suppliers: {res['suppliers_created']}, "
            f"customers: {res['customers_created']}"
        ))
