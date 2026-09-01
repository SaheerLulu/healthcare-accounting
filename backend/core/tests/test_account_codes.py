"""New accounts number themselves.

The chart is numbered Tally-style — one band per account type, groups and
their leaves sharing a neighbourhood — so making the user invent a code meant
either a clash or a number filed nowhere near its family.

Assertions run against the chart migration 0016 actually seeds rather than a
bare table, and derive their expectations from that data: the point is the
RULE, and hard-coding numbers would only pin today's seed.
"""
from django.test import TestCase
from rest_framework.test import APIRequestFactory, force_authenticate

from core.account_codes import CODE_BANDS, next_account_code
from core.models import ChartOfAccount
from core.tests.utils import (
    fake_active_location, make_admin, make_settings, seed_chart_and_mappings,
)
from core.views import ChartOfAccountViewSet

STORE = 1


def _numeric(codes):
    return [int(c) for c in codes if c and c.strip().isdigit()]


def _group(code):
    return ChartOfAccount.objects.get(account_code=code, location_id__isnull=True)


def _highest_child(group):
    return max(_numeric(group.children.values_list('account_code', flat=True)))


def _highest_in_band(account_type):
    lo, hi = CODE_BANDS[account_type]
    return max(n for n in _numeric(
        ChartOfAccount.objects.values_list('account_code', flat=True))
        if lo <= n <= hi)


class NextAccountCodeTests(TestCase):
    def test_each_type_is_numbered_in_its_own_band(self):
        for account_type, (lo, hi) in CODE_BANDS.items():
            with self.subTest(account_type=account_type):
                code = int(next_account_code(account_type))
                self.assertTrue(lo <= code <= hi,
                                f'{code} is outside {account_type} {lo}-{hi}')

    def test_the_allocated_code_is_always_free(self):
        taken = set(ChartOfAccount.objects.values_list('account_code', flat=True))
        for account_type in CODE_BANDS:
            with self.subTest(account_type=account_type):
                self.assertNotIn(next_account_code(account_type), taken)

    def test_top_level_account_lands_after_the_highest_in_its_band(self):
        self.assertEqual(next_account_code('ASSET'),
                         str(_highest_in_band('ASSET') + 1))

    def test_a_child_continues_its_parents_series(self):
        # 1100 Cash & Bank holds the 111x/112x leaves.
        group = _group('1100')
        self.assertEqual(next_account_code('ASSET', group),
                         str(_highest_child(group) + 1))

    def test_a_child_is_never_numbered_below_its_group(self):
        """The seed hangs 54xx leaves off 5700 Indirect Expenses. Anchoring on
        the children alone would file a new child hundreds below its group."""
        group = _group('5700')
        self.assertLess(_highest_child(group), 5700,
                        'fixture assumption: 5700 holds lower-numbered leaves')
        self.assertEqual(next_account_code('EXPENSE', group), '5701')

    def test_an_occupied_number_is_skipped(self):
        group = _group('1100')
        blocked = _highest_child(group) + 1
        # Free by parentage but taken by an unrelated account elsewhere.
        ChartOfAccount.objects.create(
            account_code=str(blocked), account_name='Squatter',
            account_type='ASSET', is_leaf=True, is_active=True)
        # Walks on to the next FREE number — 1125 Sundry Debtors sits in the
        # way in the seeded chart, so "blocked + 1" is not the answer.
        taken = set(_numeric(
            ChartOfAccount.objects.values_list('account_code', flat=True)))
        expected = next(n for n in range(blocked + 1, 2000) if n not in taken)
        self.assertEqual(next_account_code('ASSET', group), str(expected))

    def test_codes_are_unique_across_stores_not_just_within_one(self):
        """The DB only enforces (code, location), but a bare code is printed on
        every report — it has to mean one thing company-wide."""
        taken_elsewhere = str(_highest_in_band('ASSET') + 1)
        ChartOfAccount.objects.create(
            account_code=taken_elsewhere, account_name='Store 2 account',
            account_type='ASSET', location_id=2, is_leaf=True, is_active=True)
        self.assertNotEqual(next_account_code('ASSET'), taken_elsewhere)

    def test_suffixed_clone_codes_do_not_burn_a_number(self):
        """'1110-MUM' is derived from 1110, which is already counted. Treating
        the clone as a number of its own would skip one for nothing."""
        group = _group('1100')
        expected = str(_highest_child(group) + 1)
        ChartOfAccount.objects.create(
            account_code=f'{expected}-MUM', account_name='Cloned leaf',
            account_type='ASSET', parent=group, location_id=2,
            is_leaf=True, is_active=True)
        self.assertEqual(next_account_code('ASSET', group), expected)

    def test_a_parent_in_another_band_is_ignored(self):
        # Nonsensical data (an EXPENSE under an ASSET group) must still yield a
        # code in the new account's OWN band, not the parent's.
        code = int(next_account_code('EXPENSE', _group('1100')))
        lo, hi = CODE_BANDS['EXPENSE']
        self.assertTrue(lo <= code <= hi)

    def test_a_gap_below_the_anchor_is_reused_when_the_top_is_full(self):
        lo, hi = CODE_BANDS['EQUITY']
        taken = set(_numeric(
            ChartOfAccount.objects.values_list('account_code', flat=True)))
        gap = next(n for n in range(lo, hi + 1) if n not in taken)
        ChartOfAccount.objects.bulk_create([
            ChartOfAccount(account_code=str(n), account_name=f'Filler {n}',
                           account_type='EQUITY', is_leaf=True, is_active=True)
            for n in range(lo, hi + 1) if n not in taken and n != gap
        ])
        self.assertEqual(next_account_code('EQUITY'), str(gap))

    def test_a_full_band_is_reported_not_silently_wrong(self):
        lo, hi = CODE_BANDS['EQUITY']
        taken = set(_numeric(
            ChartOfAccount.objects.values_list('account_code', flat=True)))
        ChartOfAccount.objects.bulk_create([
            ChartOfAccount(account_code=str(n), account_name=f'Filler {n}',
                           account_type='EQUITY', is_leaf=True, is_active=True)
            for n in range(lo, hi + 1) if n not in taken
        ])
        with self.assertRaises(ValueError) as ctx:
            next_account_code('EQUITY')
        self.assertIn('manually', str(ctx.exception))

    def test_an_unknown_account_type_is_rejected(self):
        with self.assertRaises(ValueError):
            next_account_code('NOT_A_TYPE')


class CreateAccountApiTests(TestCase):
    def setUp(self):
        seed_chart_and_mappings()
        make_settings()
        self.admin = make_admin()
        self.factory = APIRequestFactory()

    def _create(self, payload):
        request = self.factory.post('/api/accounts/accounts/', payload,
                                    format='json', HTTP_X_LOCATION_ID=str(STORE))
        force_authenticate(request, self.admin)
        with fake_active_location(all_access=True):
            return ChartOfAccountViewSet.as_view({'post': 'create'})(request)

    def _next_code(self, **params):
        request = self.factory.get('/api/accounts/accounts/next-code/', params,
                                   HTTP_X_LOCATION_ID=str(STORE))
        force_authenticate(request, self.admin)
        with fake_active_location(all_access=True):
            return ChartOfAccountViewSet.as_view({'get': 'next_code'})(request)

    def test_an_account_created_without_a_code_gets_one(self):
        resp = self._create({'account_name': 'Courier Charges',
                             'account_type': 'EXPENSE'})
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertTrue(resp.data['account_code'].isdigit())
        lo, hi = CODE_BANDS['EXPENSE']
        self.assertTrue(lo <= int(resp.data['account_code']) <= hi)

    def test_a_blank_code_is_treated_as_absent(self):
        resp = self._create({'account_code': '   ', 'account_name': 'Freight In',
                             'account_type': 'EXPENSE'})
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertTrue(resp.data['account_code'].isdigit())

    def test_a_code_typed_by_hand_still_wins(self):
        """An accountant migrating an existing chart keeps their own numbers."""
        resp = self._create({'account_code': '6555',
                             'account_name': 'Legacy Ledger 6555',
                             'account_type': 'EXPENSE'})
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual(resp.data['account_code'], '6555')

    def test_two_accounts_in_a_row_do_not_collide(self):
        first = self._create({'account_name': 'Courier Charges',
                              'account_type': 'EXPENSE'})
        second = self._create({'account_name': 'Packing Material',
                               'account_type': 'EXPENSE'})
        self.assertEqual(first.status_code, 201, first.data)
        self.assertEqual(second.status_code, 201, second.data)
        self.assertNotEqual(first.data['account_code'],
                            second.data['account_code'])

    def test_the_new_account_is_filed_under_its_parent(self):
        group = _group('5700')
        resp = self._create({'account_name': 'Courier Charges',
                             'account_type': 'EXPENSE', 'parent': group.id})
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual(resp.data['account_code'], '5701')

    def test_editing_without_a_code_keeps_the_existing_one(self):
        created = self._create({'account_name': 'Courier Charges',
                                'account_type': 'EXPENSE'})
        code = created.data['account_code']
        request = self.factory.patch(
            f'/api/accounts/accounts/{created.data["id"]}/',
            {'account_name': 'Courier & Freight'}, format='json',
            HTTP_X_LOCATION_ID=str(STORE))
        force_authenticate(request, self.admin)
        with fake_active_location(all_access=True):
            resp = ChartOfAccountViewSet.as_view(
                {'patch': 'partial_update'})(request, pk=created.data['id'])
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(resp.data['account_code'], code)

    def test_preview_matches_what_create_actually_assigns(self):
        preview = self._next_code(account_type='EXPENSE')
        self.assertEqual(preview.status_code, 200, preview.data)
        created = self._create({'account_name': 'Courier Charges',
                                'account_type': 'EXPENSE'})
        self.assertEqual(created.status_code, 201, created.data)
        self.assertEqual(created.data['account_code'],
                         preview.data['account_code'])

    def test_preview_follows_the_parent(self):
        group = _group('5700')
        with_parent = self._next_code(account_type='EXPENSE', parent=group.id)
        without = self._next_code(account_type='EXPENSE')
        self.assertEqual(with_parent.data['account_code'], '5701')
        self.assertNotEqual(with_parent.data['account_code'],
                            without.data['account_code'])

    def test_preview_rejects_a_missing_or_bogus_account_type(self):
        self.assertEqual(self._next_code().status_code, 400)
        self.assertEqual(self._next_code(account_type='NOPE').status_code, 400)
