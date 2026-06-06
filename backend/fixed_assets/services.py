"""Acquisition, monthly depreciation, and disposal services for FixedAsset."""
from calendar import monthrange
from datetime import date as date_cls
from decimal import Decimal, ROUND_HALF_UP

from django.core.exceptions import ValidationError
from django.db import transaction

from core.models import AccountMapping
from journals.models import JournalEntry, JournalEntryLine

from .models import AssetClass, DepreciationEntry, FixedAsset


def _last_day(d: date_cls) -> date_cls:
    return date_cls(d.year, d.month, monthrange(d.year, d.month)[1])


def _add_one_month(d: date_cls) -> date_cls:
    if d.month == 12:
        return date_cls(d.year + 1, 1, 1)
    return date_cls(d.year, d.month + 1, 1)


@transaction.atomic
def post_acquisition(asset: FixedAsset, *, payment_mode: str = 'bank',
                    user=None) -> JournalEntry:
    """Dr Asset (cost), Cr Bank (or Trade Payables)."""
    if asset.acquisition_journal_entry_id:
        raise ValidationError('Acquisition JE already posted for this asset.')

    asset_acct = asset.asset_class.asset_account
    if payment_mode == 'bank':
        credit_acct = AccountMapping.get_account('BANK')
    elif payment_mode == 'cash':
        credit_acct = AccountMapping.get_account('CASH')
    else:
        credit_acct = AccountMapping.get_account('TRADE_PAYABLES')

    je = JournalEntry.objects.create(
        date=asset.acquisition_date,
        narration=f'Acquisition of {asset.asset_no} — {asset.name}',
        voucher_type='JOURNAL', reference_type='Manual',
        location_id=asset.location_id,
        created_by=user,
    )
    JournalEntryLine.objects.create(entry=je, account=asset_acct,
                                    debit=asset.acquisition_cost)
    cr_kwargs = {'entry': je, 'account': credit_acct, 'credit': asset.acquisition_cost}
    if payment_mode == 'credit' and asset.vendor_id:
        from core.party_ledgers import resolve_party_account
        cr_kwargs['account'] = resolve_party_account(
            'Supplier', asset.vendor_id, credit_acct, location_id=asset.location_id)
        cr_kwargs['party_type'] = 'Supplier'
        cr_kwargs['party_id'] = asset.vendor_id
    JournalEntryLine.objects.create(**cr_kwargs)
    je.post()

    asset.acquisition_journal_entry = je
    asset.save(update_fields=['acquisition_journal_entry', 'updated_at'])
    return je


def _disposal_pl_account(asset: FixedAsset, *, is_gain: bool):
    """The P&L account for a disposal gain/loss — a dedicated 'Profit/Loss on
    Sale of Asset' GL (4950 / 5482) so disposal results don't pollute the
    depreciation-expense total. Falls back to the class's depreciation-expense
    account only when the dedicated GL is absent (preserves prior behaviour)."""
    from core.models import ChartOfAccount
    code = '4950' if is_gain else '5482'   # Profit / Loss on Sale of Asset
    acct = ChartOfAccount.objects.filter(
        account_code=code, is_leaf=True, is_active=True).first()
    return acct or asset.asset_class.dep_expense_account


def _slm_monthly(asset: FixedAsset) -> Decimal:
    base = asset.depreciable_base
    months = asset.effective_life_months or 1
    return (base / Decimal(months)).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)


def _wdv_monthly(asset: FixedAsset, *, as_of: date_cls) -> Decimal:
    """WDV: depreciate (current NBV - residual) by (annual rate / 12)."""
    rate = asset.asset_class.wdv_rate_pct or Decimal('0')
    if rate <= 0:
        return Decimal('0.00')
    nbv = asset.net_book_value(as_of=as_of)
    base = max(nbv - asset.effective_salvage_value, Decimal('0.00'))
    monthly = base * rate / Decimal('100') / Decimal('12')
    return monthly.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)


def compute_monthly_depreciation(asset: FixedAsset, *, period: str) -> Decimal:
    """How much depreciation should hit this asset for `period` (YYYY-MM)."""
    if asset.status != 'active':
        return Decimal('0.00')
    period_end = date_cls(*[int(x) for x in (period.split('-') + ['28'])][:3])
    period_end = _last_day(period_end)
    if asset.acquisition_date > period_end:
        return Decimal('0.00')
    method = asset.asset_class.dep_method
    if method == 'SLM':
        amt = _slm_monthly(asset)
    elif method == 'WDV':
        amt = _wdv_monthly(asset, as_of=period_end)
    else:
        return Decimal('0.00')
    # Don't depreciate below the residual (Schedule II — typically 5% of cost).
    nbv = asset.net_book_value(as_of=period_end)
    headroom = max(nbv - asset.effective_salvage_value, Decimal('0.00'))
    return min(amt, headroom)


@transaction.atomic
def post_monthly_depreciation(period: str, *, location_id: int = None,
                              user=None) -> dict:
    """Post one combined depreciation JE per asset class for the given period.

    Idempotent — if a DepreciationEntry already exists for an asset+period,
    that asset is skipped.
    """
    period_end = date_cls(*[int(x) for x in (period.split('-') + ['28'])][:3])
    period_end = _last_day(period_end)

    qs = FixedAsset.objects.filter(status='active').select_related('asset_class')
    if location_id is not None:
        qs = qs.filter(location_id=location_id)

    # Group by (location, asset_class): one JE per class PER STORE so each
    # store's books carry only its own depreciation (store isolation).
    by_group = {}
    for asset in qs:
        if DepreciationEntry.objects.filter(fixed_asset=asset, period=period).exists():
            continue
        amt = compute_monthly_depreciation(asset, period=period)
        if amt <= 0:
            continue
        by_group.setdefault((asset.location_id, asset.asset_class_id), []).append((asset, amt))

    posted = []
    for (loc_id, class_id), items in by_group.items():
        if not items:
            continue
        ac = items[0][0].asset_class
        total = sum(a for _, a in items)

        je = JournalEntry.objects.create(
            date=period_end,
            narration=f'Depreciation for {period} — {ac.name}',
            voucher_type='JOURNAL', reference_type='Manual',
            location_id=loc_id,
            created_by=user,
        )
        JournalEntryLine.objects.create(
            entry=je, account=ac.dep_expense_account, debit=total,
        )
        JournalEntryLine.objects.create(
            entry=je, account=ac.accum_dep_account, credit=total,
        )
        je.post()

        for asset, amt in items:
            DepreciationEntry.objects.create(
                fixed_asset=asset, period=period, amount=amt,
                method=ac.dep_method, journal_entry=je,
            )
        posted.append({'class': ac.code, 'asset_count': len(items),
                       'amount': str(total), 'entry_no': je.entry_no})

    return {'period': period, 'posted': posted}


@transaction.atomic
def dispose_asset(asset: FixedAsset, *, disposal_date: date_cls,
                  proceeds: Decimal, mode: str = 'bank', user=None) -> JournalEntry:
    """
    Dispose of an asset. Books:
      Dr Bank/Cash       (proceeds)
      Dr Accum Dep       (full to date)
      Cr Asset           (cost)
      Dr/Cr P&L          (loss/gain)
    """
    if asset.status != 'active':
        raise ValidationError(f'Asset is {asset.status}, cannot dispose.')
    # Disposal credits the asset GL for its full cost — that credit must offset a
    # real prior debit. Without a posted acquisition JE there was never one, so
    # disposal would push the asset account negative and mis-state gain/loss.
    if asset.acquisition_journal_entry_id is None:
        raise ValidationError(
            'Asset has no posted acquisition entry — post the acquisition before disposal.'
        )

    proceeds = Decimal(str(proceeds))
    accum = asset.accumulated_depreciation(as_of=disposal_date)
    nbv = asset.acquisition_cost - accum
    gain_loss = proceeds - nbv  # positive = gain, negative = loss

    je = JournalEntry.objects.create(
        date=disposal_date,
        narration=f'Disposal of {asset.asset_no} — {asset.name} '
                  f'(NBV {nbv}, proceeds {proceeds})',
        voucher_type='JOURNAL', reference_type='Manual',
        location_id=asset.location_id,
        created_by=user,
    )
    cash_acct = (AccountMapping.get_account('BANK') if mode == 'bank'
                 else AccountMapping.get_account('CASH'))
    if proceeds > 0:
        JournalEntryLine.objects.create(entry=je, account=cash_acct, debit=proceeds)
    if accum > 0:
        JournalEntryLine.objects.create(
            entry=je, account=asset.asset_class.accum_dep_account, debit=accum,
        )
    JournalEntryLine.objects.create(
        entry=je, account=asset.asset_class.asset_account,
        credit=asset.acquisition_cost,
    )
    if gain_loss != 0:
        # Gain/loss on disposal hits a dedicated Profit/Loss-on-Sale GL so it
        # doesn't distort the period's depreciation expense.
        if gain_loss > 0:
            JournalEntryLine.objects.create(
                entry=je, account=_disposal_pl_account(asset, is_gain=True),
                credit=gain_loss,
            )
        else:
            JournalEntryLine.objects.create(
                entry=je, account=_disposal_pl_account(asset, is_gain=False),
                debit=-gain_loss,
            )
    je.post()

    asset.status = 'disposed'
    asset.disposal_date = disposal_date
    asset.disposal_proceeds = proceeds
    asset.gain_loss_on_disposal = gain_loss
    asset.disposal_journal_entry = je
    asset.save(update_fields=['status', 'disposal_date', 'disposal_proceeds',
                              'gain_loss_on_disposal', 'disposal_journal_entry',
                              'updated_at'])
    return je
