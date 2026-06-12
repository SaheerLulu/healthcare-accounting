from rest_framework import serializers
from decimal import Decimal
from .models import (
    JournalEntry, JournalEntryLine, RecurringJournal, RecurringJournalLine,
    BillReference, VoucherTypeProfile,
)


def _trade_control_ids():
    """Account ids mapped to the Trade Payables/Receivables control, any
    location. Fetched once per save so line routing is a set membership test
    rather than a query per line."""
    from core.models import AccountMapping
    return set(AccountMapping.objects.filter(
        key__in=('TRADE_PAYABLES', 'TRADE_RECEIVABLES'),
    ).values_list('account_id', flat=True))


def _route_party_line(line_data, control_ids, location_id=None):
    """Keep each line's account and party tag consistent:

    - If the account IS a per-party ledger, carry that ledger's party onto the
      line (auto-tag / auto-correct) so the model invariant always holds and the
      caller needn't send the tag at all.
    - If a party-tagged line points at the generic Trade Payables/Receivables
      control, redirect it to that party's own ledger.
    Other lines are left untouched. Mutates a copy and returns it.
    """
    from core.party_ledgers import resolve_party_account

    acct = line_data.get('account')
    if acct is None:
        return line_data

    # The account IS a per-party ledger → carry its party.
    if getattr(acct, 'party_id', None) is not None:
        if (line_data.get('party_type'), line_data.get('party_id')) \
                != (acct.party_type, acct.party_id):
            line_data = dict(line_data)
            line_data['party_type'] = acct.party_type
            line_data['party_id'] = acct.party_id
        return line_data

    # A party-tagged line on the Trade control → redirect to the party ledger.
    ptype = line_data.get('party_type')
    pid = line_data.get('party_id')
    if ptype not in ('Supplier', 'Customer') or not pid or acct.id not in control_ids:
        return line_data
    routed = dict(line_data)
    routed['account'] = resolve_party_account(ptype, pid, acct, location_id=location_id)
    return routed


class BillReferenceSerializer(serializers.ModelSerializer):
    class Meta:
        model = BillReference
        fields = [
            'id', 'line', 'kind', 'ref_no', 'ref_date',
            'amount', 'bill_id', 'created_at',
        ]
        read_only_fields = ['id', 'created_at']

    def validate(self, data):
        """Server-side over-allocation guard: a bill-wise AGAINST allocation may
        not push the cumulative amount settled against an invoice past that
        invoice's original balance. Scoped by party + subtype + location so it
        can't be defeated by a direct API POST or a stale tab."""
        from django.db.models import Sum
        kind = data.get('kind') or getattr(self.instance, 'kind', None)
        line = data.get('line') or getattr(self.instance, 'line', None)
        ref_no = data.get('ref_no') or getattr(self.instance, 'ref_no', '')
        amount = data.get('amount') if 'amount' in data else getattr(self.instance, 'amount', Decimal('0'))
        if kind != 'AGAINST' or line is None or not amount:
            return data

        # Allocation against a bills-app Bill (H32): cap at the bill's live
        # outstanding balance. The viewset applies/releases the amount on
        # Bill.amount_paid, so balance_due reflects prior allocations and
        # BillPayments alike.
        bill_id = data.get('bill_id') if 'bill_id' in data \
            else getattr(self.instance, 'bill_id', None)
        if bill_id:
            from bills.models import Bill
            bill = Bill.objects.filter(pk=bill_id).first()
            if bill is not None:
                remaining = bill.balance_due
                if (self.instance and self.instance.kind == 'AGAINST'
                        and self.instance.bill_id == bill_id):
                    # Editing an applied allocation: its own amount already
                    # sits inside amount_paid, so it is still available.
                    remaining += self.instance.amount
                if amount > remaining + Decimal('0.005'):
                    raise serializers.ValidationError(
                        f'Allocation {amount} exceeds bill '
                        f'{bill.bill_no or bill.pk} balance due {remaining}.'
                    )

        if not ref_no:
            return data

        party_type = line.party_type
        subtype = line.account.account_subtype if line.account_id else ''
        loc = line.entry.location_id if line.entry_id else None
        if party_type not in ('Supplier', 'Customer'):
            return data

        inv_qs = JournalEntryLine.objects.filter(
            entry__entry_no=ref_no, party_type=party_type,
            party_id=line.party_id, account__account_subtype=subtype,
        )
        if loc is not None:
            inv_qs = inv_qs.filter(entry__location_id=loc)
        invoice = inv_qs.select_related('entry').first()
        if invoice is None:
            return data  # freeform / non-JE reference — nothing to cap against

        original = invoice.credit if party_type == 'Supplier' else invoice.debit
        prior = BillReference.objects.filter(
            kind='AGAINST', ref_no=ref_no,
            line__party_type=party_type, line__party_id=line.party_id,
            line__account__account_subtype=subtype,
        )
        if loc is not None:
            prior = prior.filter(line__entry__location_id=loc)
        if self.instance:
            prior = prior.exclude(pk=self.instance.pk)
        prior_sum = prior.aggregate(s=Sum('amount'))['s'] or Decimal('0')
        if prior_sum + amount > original + Decimal('0.005'):
            raise serializers.ValidationError(
                f'Allocation {amount} exceeds invoice {ref_no} remaining '
                f'balance {original - prior_sum}.'
            )
        return data


class JournalEntryLineSerializer(serializers.ModelSerializer):
    account_name = serializers.CharField(source='account.account_name', read_only=True)
    account_code = serializers.CharField(source='account.account_code', read_only=True)
    bill_references = BillReferenceSerializer(many=True, read_only=True)

    class Meta:
        model = JournalEntryLine
        fields = [
            'id',
            'entry',
            'account',
            'account_name',
            'account_code',
            'debit',
            'credit',
            'narration',
            'party_type',
            'party_id',
            'bill_references',
        ]
        read_only_fields = ['id']


class JournalEntrySerializer(serializers.ModelSerializer):
    lines = JournalEntryLineSerializer(many=True, read_only=True)
    created_by_name = serializers.SerializerMethodField()
    voucher_type_display = serializers.CharField(source='get_voucher_type_display', read_only=True)
    reference_type_display = serializers.CharField(source='get_reference_type_display', read_only=True)

    class Meta:
        model = JournalEntry
        fields = [
            'id',
            'entry_no',
            'date',
            'narration',
            'voucher_type',
            'voucher_type_display',
            'voucher_type_profile',
            'reference_type',
            'reference_type_display',
            'reference_id',
            'is_posted',
            'is_optional',
            'is_memorandum',
            'reversal_date',
            'auto_reversed',
            'location_id',
            'cost_center',
            'cost_centre',
            'created_at',
            'created_by',
            'created_by_name',
            'lines',
        ]
        read_only_fields = ['id', 'entry_no', 'created_at', 'is_posted', 'auto_reversed']

    def get_created_by_name(self, obj):
        if obj.created_by:
            return obj.created_by.get_full_name() or obj.created_by.username
        return None


class JournalEntryLineCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = JournalEntryLine
        fields = [
            'account',
            'debit',
            'credit',
            'narration',
            'party_type',
            'party_id',
        ]

    def validate(self, data):
        debit = data.get('debit', 0)
        credit = data.get('credit', 0)
        if debit < 0 or credit < 0:
            raise serializers.ValidationError('Debit and Credit must be non-negative.')
        if debit > 0 and credit > 0:
            raise serializers.ValidationError('A line cannot have both debit and credit.')
        return data


class JournalEntryCreateSerializer(serializers.ModelSerializer):
    lines = JournalEntryLineCreateSerializer(many=True)
    location_id = serializers.IntegerField(required=True, allow_null=False)

    class Meta:
        model = JournalEntry
        fields = [
            'id',
            'entry_no',
            'date',
            'narration',
            'voucher_type',
            'voucher_type_profile',
            'reference_type',
            'reference_id',
            'location_id',
            'cost_center',
            'cost_centre',
            'is_optional',
            'is_memorandum',
            'reversal_date',
            'lines',
        ]
        read_only_fields = ['id', 'entry_no']

    PARTY_REQUIRED_SUBTYPES = ('Receivable', 'Payable')

    def validate(self, data):
        lines = data.get('lines', [])
        # AC WP 615: at least 2 lines (one debit, one credit).
        if len(lines) < 2:
            raise serializers.ValidationError(
                'A journal entry needs at least two lines (one debit, one credit).'
            )

        # Sum to paisa precision and compare exactly — no float drift.
        total_debit = sum((Decimal(str(l.get('debit', 0))) for l in lines), Decimal('0.00'))
        total_credit = sum((Decimal(str(l.get('credit', 0))) for l in lines), Decimal('0.00'))
        if total_debit != total_credit:
            raise serializers.ValidationError(
                f'Journal entry is unbalanced: Debit={total_debit}, Credit={total_credit}'
            )
        if total_debit == 0:
            raise serializers.ValidationError('Journal entry total cannot be zero.')

        control_ids = _trade_control_ids()
        line_errors = {}
        for idx, line in enumerate(lines):
            account = line.get('account')
            # Posting to a non-leaf account would silently fall out of the P&L
            # (which sums leaf accounts only) while still affecting the Balance
            # Sheet's net-income calc — the two reports would no longer tie.
            if account is not None and not getattr(account, 'is_leaf', True):
                line_errors[idx] = (
                    f'Cannot post to non-leaf account {account.account_code} '
                    f'{account.account_name} (line {idx + 1}). Post to a leaf account.'
                )
                continue
            # Inactive accounts are retired from posting — surface a clean
            # per-line 400 instead of the model-level save error.
            if account is not None and not getattr(account, 'is_active', True):
                line_errors[idx] = (
                    f'Account {account.account_code} {account.account_name} '
                    f'is inactive (line {idx + 1}). Reactivate it or pick '
                    f'another account.'
                )
                continue
            # Per-party-ledger line explicitly tagged with a DIFFERENT concrete
            # party: the voucher's header party and the line's ledger disagree.
            # _route_party_line would silently overwrite the tag to the ledger's
            # own party — posting the receivable/payable to the WRONG party's
            # books. Reject it instead of silently rerouting. (An untagged line on
            # a per-party ledger is fine — that's the legitimate auto-tag path.)
            if account is not None and getattr(account, 'party_id', None) is not None:
                ptype, pid = line.get('party_type'), line.get('party_id')
                if pid and ptype in ('Supplier', 'Customer') \
                        and (ptype, pid) != (account.party_type, account.party_id):
                    line_errors[idx] = (
                        f'Line {idx + 1} posts to the {account.party_type} ledger '
                        f'{account.account_code} ({account.account_name}), but the voucher '
                        f'is for {ptype} #{pid}. Pick the matching ledger or change the party.'
                    )
                    continue
            # A party is required only for TRADE payable/receivable. Per-party
            # ledgers carry their own party (auto-tagged in create), and
            # statutory payables (PF/ESI/TDS…) are subtype Payable but need none.
            # Only the bare Trade Payables/Receivables CONTROL must name a party.
            if account is not None and getattr(account, 'party_id', None) is None \
                    and account.id in control_ids:
                if not line.get('party_type') or not line.get('party_id'):
                    line_errors[idx] = (
                        f'Select a supplier/customer for {account.account_code} '
                        f'{account.account_name} (line {idx + 1}), or post to the '
                        f"party's own ledger."
                    )
        if line_errors:
            raise serializers.ValidationError({'lines': line_errors})

        # Period lock check — surfaces a clean 400 with the offending date.
        from core.period_lock import assert_unlocked, PeriodLockedError
        try:
            assert_unlocked(data.get('date'))
        except PeriodLockedError as exc:
            raise serializers.ValidationError({'date': str(exc)})

        return data

    def create(self, validated_data):
        lines_data = validated_data.pop('lines')
        request = self.context.get('request')
        if request and request.user.is_authenticated:
            validated_data['created_by'] = request.user

        entry = JournalEntry.objects.create(**validated_data)
        control_ids = _trade_control_ids()
        for line_data in lines_data:
            JournalEntryLine.objects.create(
                entry=entry, **_route_party_line(line_data, control_ids, entry.location_id))
        return entry

    def update(self, instance, validated_data):
        if instance.is_posted:
            raise serializers.ValidationError('Cannot edit a posted journal entry.')
        lines_data = validated_data.pop('lines', None)
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        if lines_data is not None:
            # Replacing the lines CASCADE-drops their bill references; release
            # bill-linked allocations first so Bill.amount_paid rolls back (the
            # voucher editor re-attaches refs after saving, re-applying them).
            from bills.services import release_voucher_allocations
            release_voucher_allocations(
                BillReference.objects.filter(line__entry=instance))
            instance.lines.all().delete()
            control_ids = _trade_control_ids()
            for line_data in lines_data:
                JournalEntryLine.objects.create(
                    entry=instance, **_route_party_line(line_data, control_ids, instance.location_id))
        return instance


# ─── Voucher Serializers ─────────────────────────────────────────────────────

class PaymentVoucherSerializer(serializers.Serializer):
    date = serializers.DateField()
    amount = serializers.DecimalField(max_digits=15, decimal_places=2, min_value=Decimal('0.01'))
    party_id = serializers.IntegerField(required=False, allow_null=True)
    payment_mode = serializers.ChoiceField(choices=['bank', 'cash'], default='bank')
    # Specific Bank-subtype ChartOfAccount when payment_mode='bank'. Falls
    # back to AccountMapping['BANK'] if omitted.
    bank_account_id = serializers.IntegerField(required=False, allow_null=True)
    narration = serializers.CharField(required=False, allow_blank=True, default='Payment')
    location_id = serializers.IntegerField(required=True, allow_null=False)


class ReceiptVoucherSerializer(serializers.Serializer):
    date = serializers.DateField()
    amount = serializers.DecimalField(max_digits=15, decimal_places=2, min_value=Decimal('0.01'))
    party_id = serializers.IntegerField(required=False, allow_null=True)
    receipt_mode = serializers.ChoiceField(choices=['bank', 'cash'], default='bank')
    narration = serializers.CharField(required=False, allow_blank=True, default='Receipt')
    location_id = serializers.IntegerField(required=True, allow_null=False)
    skip_ar_check = serializers.BooleanField(required=False, default=False)


class ContraVoucherSerializer(serializers.Serializer):
    date = serializers.DateField()
    amount = serializers.DecimalField(max_digits=15, decimal_places=2, min_value=Decimal('0.01'))
    direction = serializers.ChoiceField(choices=['bank_to_cash', 'cash_to_bank'], default='bank_to_cash')
    narration = serializers.CharField(required=False, allow_blank=True, default='Contra Entry')
    location_id = serializers.IntegerField(required=True, allow_null=False)


# ─── Recurring journals ─────────────────────────────────────────────────────

class RecurringJournalLineReadSerializer(serializers.ModelSerializer):
    account_code = serializers.CharField(source='account.account_code', read_only=True)
    account_name = serializers.CharField(source='account.account_name', read_only=True)

    class Meta:
        model = RecurringJournalLine
        fields = ['id', 'account', 'account_code', 'account_name',
                  'debit', 'credit', 'narration', 'party_type', 'party_id']


class RecurringJournalLineWriteSerializer(serializers.ModelSerializer):
    class Meta:
        model = RecurringJournalLine
        fields = ['account', 'debit', 'credit', 'narration', 'party_type', 'party_id']

    def validate(self, data):
        debit = data.get('debit', 0)
        credit = data.get('credit', 0)
        if debit < 0 or credit < 0:
            raise serializers.ValidationError('Debit/Credit must be non-negative.')
        if debit > 0 and credit > 0:
            raise serializers.ValidationError('A line cannot have both debit and credit.')
        return data


class RecurringJournalReadSerializer(serializers.ModelSerializer):
    lines = RecurringJournalLineReadSerializer(many=True, read_only=True)
    voucher_type_display = serializers.CharField(source='get_voucher_type_display', read_only=True)
    generated_count = serializers.SerializerMethodField()
    generated_recent = serializers.SerializerMethodField()
    total_debit = serializers.SerializerMethodField()
    total_credit = serializers.SerializerMethodField()
    is_balanced = serializers.SerializerMethodField()
    created_by_name = serializers.SerializerMethodField()

    class Meta:
        model = RecurringJournal
        fields = [
            'id', 'profile_name', 'voucher_type', 'voucher_type_display',
            'narration_template', 'location_id',
            'frequency', 'start_date', 'end_date', 'next_run_date', 'last_run_date',
            'auto_post', 'status', 'last_error',
            'lines', 'total_debit', 'total_credit', 'is_balanced',
            'generated_count', 'generated_recent',
            'created_at', 'updated_at', 'created_by', 'created_by_name',
        ]
        read_only_fields = [
            'id', 'voucher_type_display', 'next_run_date', 'last_run_date',
            'status', 'last_error', 'lines',
            'total_debit', 'total_credit', 'is_balanced',
            'generated_count', 'generated_recent',
            'created_at', 'updated_at', 'created_by', 'created_by_name',
        ]

    def get_generated_count(self, obj):
        # KNOWN-BROKEN HEURISTIC kept for shape compatibility: nothing ever
        # writes a 'recurring-journal:<id>' token into JE narrations, so this
        # icontains scan always returns 0. It is now computed only on
        # retrieve (see RecurringJournalListSerializer) so the list page no
        # longer runs one full-table scan per profile for a constant 0.
        # The real fix is an FK from generated entries back to the profile.
        return JournalEntry.objects.filter(
            narration__icontains=f'recurring-journal:{obj.id}'
        ).count()

    def get_generated_recent(self, obj):
        # Lighter approach: find by voucher_type + date range + narration prefix.
        # Falls back to scanning recent entries created via this profile.
        # Since we don't currently embed a recurring_id token in narration,
        # match by profile_name as a heuristic. Retrieve-only (one profile →
        # one scan); the list serializer omits it.
        qs = JournalEntry.objects.filter(narration__icontains=obj.profile_name) \
            .order_by('-date', '-id')[:5]
        return [{
            'id': e.id, 'entry_no': e.entry_no, 'date': e.date,
            'is_posted': e.is_posted,
        } for e in qs]

    def get_total_debit(self, obj):
        return str(sum((l.debit for l in obj.lines.all()), Decimal('0.00')))

    def get_total_credit(self, obj):
        return str(sum((l.credit for l in obj.lines.all()), Decimal('0.00')))

    def get_is_balanced(self, obj):
        dr = sum((l.debit for l in obj.lines.all()), Decimal('0.00'))
        cr = sum((l.credit for l in obj.lines.all()), Decimal('0.00'))
        return dr == cr and dr > 0

    def get_created_by_name(self, obj):
        if obj.created_by:
            return obj.created_by.get_full_name() or obj.created_by.username
        return None


class RecurringJournalListSerializer(RecurringJournalReadSerializer):
    """List rows without generated_count / generated_recent.

    Both fields run a narration__icontains scan over the whole journal table
    PER PROFILE — and generated_count matches a token that is never written,
    so the list paid N full scans to render a column of zeros. The detail
    (retrieve) response keeps both fields.
    """
    generated_count = None
    generated_recent = None

    class Meta(RecurringJournalReadSerializer.Meta):
        fields = [
            f for f in RecurringJournalReadSerializer.Meta.fields
            if f not in ('generated_count', 'generated_recent')
        ]
        read_only_fields = [
            f for f in RecurringJournalReadSerializer.Meta.read_only_fields
            if f not in ('generated_count', 'generated_recent')
        ]


class RecurringJournalWriteSerializer(serializers.ModelSerializer):
    lines = RecurringJournalLineWriteSerializer(many=True)

    class Meta:
        model = RecurringJournal
        fields = [
            'id', 'profile_name', 'voucher_type', 'narration_template', 'location_id',
            'frequency', 'start_date', 'end_date', 'next_run_date',
            'auto_post', 'lines',
        ]
        read_only_fields = ['id']
        extra_kwargs = {'next_run_date': {'required': False}}

    def validate(self, data):
        lines = data.get('lines') or []
        if len(lines) < 2:
            raise serializers.ValidationError('At least two lines are required.')
        total_dr = sum(l.get('debit', 0) for l in lines)
        total_cr = sum(l.get('credit', 0) for l in lines)
        if total_dr != total_cr or total_dr == 0:
            raise serializers.ValidationError(
                f'Template must balance: Dr {total_dr} != Cr {total_cr}.'
            )
        if not data.get('next_run_date'):
            data['next_run_date'] = data['start_date']
        if data.get('end_date') and data['end_date'] < data['start_date']:
            raise serializers.ValidationError('End date cannot be before start date.')
        return data

    def create(self, validated_data):
        lines = validated_data.pop('lines')
        request = self.context.get('request')
        if request and request.user.is_authenticated:
            validated_data['created_by'] = request.user
        rj = RecurringJournal.objects.create(**validated_data)
        for l in lines:
            RecurringJournalLine.objects.create(recurring_journal=rj, **l)
        return rj

    def update(self, instance, validated_data):
        lines = validated_data.pop('lines', None)
        for k, v in validated_data.items():
            setattr(instance, k, v)
        instance.save()
        if lines is not None:
            instance.lines.all().delete()
            for l in lines:
                RecurringJournalLine.objects.create(recurring_journal=instance, **l)
        return instance


class VoucherTypeProfileSerializer(serializers.ModelSerializer):
    base_type_display = serializers.CharField(source='get_base_type_display', read_only=True)

    class Meta:
        model = VoucherTypeProfile
        fields = [
            'id', 'name', 'base_type', 'base_type_display',
            'prefix', 'numbering_method', 'restart_yearly',
            'default_narration', 'is_active',
        ]
