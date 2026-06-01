"""Provision per-party ledger accounts from the inventory master.

Creates one shared leaf ledger per supplier (under 2105 Sundry Creditors) and
per customer (under 1125 Sundry Debtors), idempotently, via the single
`core.party_ledgers.get_or_create_party_ledger` chokepoint. Safe to re-run —
existing ledgers are left untouched (name is refreshed only with --rename).

Scope (matches the product decision "named & credit customers only"): every
SupplierRO and every CustomerRO get a ledger. Walk-in / cash POS sales carry a
NULL customer FK (no CustomerRO row), so they never get a ledger — they post to
the Cash / generic control. There is therefore nothing to filter out here.

Examples:
  ./manage.py provision_party_ledgers --suppliers --customers
  ./manage.py provision_party_ledgers --all --dry-run
  ./manage.py provision_party_ledgers --customers --rename   # refresh names too
"""
from django.core.management.base import BaseCommand, CommandError

from core.party_ledgers import (
    get_or_create_party_ledger, get_party_ledger, _party_name,
)


class Command(BaseCommand):
    help = 'Create per-party ledger accounts from the inventory supplier/customer master.'

    def add_arguments(self, parser):
        parser.add_argument('--suppliers', action='store_true',
                            help='Provision a ledger for every SupplierRO.')
        parser.add_argument('--customers', action='store_true',
                            help='Provision a ledger for every CustomerRO.')
        parser.add_argument('--all', action='store_true',
                            help='Both suppliers and customers.')
        parser.add_argument('--dry-run', action='store_true',
                            help='Report what would be created without writing.')
        parser.add_argument('--rename', action='store_true',
                            help='Refresh the ledger name from the master for '
                                 'existing ledgers (default: leave names as-is).')

    def handle(self, *args, **opts):
        do_suppliers = opts['suppliers'] or opts['all']
        do_customers = opts['customers'] or opts['all']
        if not (do_suppliers or do_customers):
            raise CommandError('Choose --suppliers, --customers, or --all.')

        dry = opts['dry_run']
        rename = opts['rename']
        created = existing = renamed = 0

        if do_suppliers:
            c, e, r = self._provision('Supplier', dry, rename)
            created += c; existing += e; renamed += r
        if do_customers:
            c, e, r = self._provision('Customer', dry, rename)
            created += c; existing += e; renamed += r

        self.stdout.write(self.style.SUCCESS(
            f'Party ledgers — created {created}, existing {existing}, '
            f'renamed {renamed}' + ('  [DRY-RUN — nothing written]' if dry else '')
        ))

    def _provision(self, party_type, dry, rename):
        from inventory_reader.models import SupplierRO, CustomerRO
        model = SupplierRO if party_type == 'Supplier' else CustomerRO
        ids = list(model.objects.values_list('id', flat=True))
        created = existing = renamed = 0

        for pid in ids:
            ledger = get_party_ledger(party_type, pid)
            if ledger is not None:
                existing += 1
                if rename and not dry:
                    fresh = _party_name(party_type, pid)
                    if fresh and fresh != ledger.account_name:
                        ledger.account_name = fresh
                        ledger.save(update_fields=['account_name', 'updated_at'])
                        renamed += 1
                continue
            if dry:
                created += 1
                continue
            get_or_create_party_ledger(party_type, pid)
            created += 1

        self.stdout.write(
            f'  {party_type}: {len(ids)} in master → '
            f'{created} new, {existing} existing'
        )
        return created, existing, renamed
