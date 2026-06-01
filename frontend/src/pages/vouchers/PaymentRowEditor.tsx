import { useEffect, useState, useMemo } from 'react'
import { Trash2, X, Loader2, ChevronDown } from 'lucide-react'
import { AccountPicker } from '../journals/AccountPicker'
import { Input } from '../../components/ui/input'
import { getBills, getOpenCustomerInvoices, type Account } from '../../lib/api'
import { formatCurrency, formatDate } from '../../lib/utils'
import { BillRefPickerSheet, type BillRefValue } from './BillRefPickerSheet'

export interface PaymentRow {
  uid: string
  /** Derived from the chosen ledger — a per-party ledger carries its party. */
  party_type: 'Supplier' | 'Customer' | null
  party_id: number | null
  account_id: number | null
  amount: string
  narration: string
  ref: BillRefValue | null
}

interface PendingRef {
  /** Display label (e.g. "BILL-001 · 12-Apr-26 · ₹1,180") */
  label: string
  /** Underlying BillRefValue applied when the user picks it. */
  value: BillRefValue
}

interface Props {
  row: PaymentRow
  accounts: Account[]
  onChange: (patch: Partial<PaymentRow>) => void
  onRemove: () => void
  onAltC?: (uid: string) => void
  removeDisabled?: boolean
}

/**
 * Single row in the SimplePaymentVoucher / SimpleReceiptVoucher table:
 * [ Ledger ] [ Reference ] [ Narration ] [ Amount ] [ × ]
 *
 * Each party IS a ledger now, so the row is driven by the Ledger picker — the
 * party (party_type/party_id) is derived from the chosen ledger upstream. When
 * the ledger is a party ledger, the Reference cell auto-loads that party's open
 * bills/invoices as an inline dropdown; "Other reference…" opens the full sheet
 * for Advance / On-Account / Freeform options.
 */
export function PaymentRowEditor({
  row, accounts, onChange, onRemove, onAltC, removeDisabled,
}: Props) {
  const [refOpen, setRefOpen] = useState(false)
  const [pendingRefs, setPendingRefs] = useState<PendingRef[]>([])
  const [pendingLoading, setPendingLoading] = useState(false)

  const selectedAccount = useMemo(
    () => (row.account_id ? accounts.find((a) => a.id === row.account_id) ?? null : null),
    [row.account_id, accounts]
  )

  // Auto-load that party's open bills/invoices the moment a party is set.
  // Re-runs when party changes; clears when party is cleared.
  useEffect(() => {
    if (!row.party_id || !row.party_type) {
      setPendingRefs([])
      return
    }
    let cancelled = false
    setPendingLoading(true)
    async function load() {
      try {
        if (row.party_type === 'Supplier') {
          const res = await getBills({
            vendor_id: String(row.party_id), status: 'open,partially_paid',
          })
          if (cancelled) return
          const list: PendingRef[] = (res.results || [])
            .filter((b) => b.status === 'open' || b.status === 'partially_paid')
            .map((b) => ({
              label: `${b.bill_no || `BILL-${b.id}`} · ${formatDate(b.bill_date)} · ${formatCurrency(b.balance_due)}`,
              value: {
                kind: 'AGAINST',
                bill_id: b.id,
                ref_no: b.bill_no || `BILL-${b.id}`,
                ref_date: b.bill_date || null,
                amount: b.balance_due,
                label: `${b.bill_no || `BILL-${b.id}`} · ${formatDate(b.bill_date)}`,
              },
            }))
          setPendingRefs(list)
        } else {
          const res = await getOpenCustomerInvoices()
          if (cancelled) return
          const list: PendingRef[] = (res.rows || [])
            .filter((r) => r.party_id === row.party_id)
            .map((inv) => ({
              label: `${inv.invoice_no} · ${formatDate(inv.date)} · ${formatCurrency(inv.amount)}`,
              value: {
                kind: 'AGAINST',
                bill_id: null,
                ref_no: inv.invoice_no,
                ref_date: inv.date,
                amount: inv.amount,
                label: `${inv.invoice_no} · ${formatDate(inv.date)}`,
              },
            }))
          setPendingRefs(list)
        }
      } catch {
        // Silent — the row still works, user can use the sheet.
        if (!cancelled) setPendingRefs([])
      } finally {
        if (!cancelled) setPendingLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [row.party_id, row.party_type])

  function clearRef() {
    onChange({ ref: null })
  }

  function applyRef(v: BillRefValue) {
    const patch: Partial<PaymentRow> = { ref: v }
    // Auto-prime amount from the bill/invoice when the row is still empty —
    // one-click settle for the common "pay one bill in full" case.
    if (v.amount && (!row.amount || parseFloat(row.amount) === 0)) {
      patch.amount = v.amount
    }
    onChange(patch)
  }

  function handlePendingPick(idx: number) {
    if (idx < 0 || idx >= pendingRefs.length) return
    applyRef(pendingRefs[idx].value)
  }

  return (
    <tr className="border-b last:border-0" style={{ borderColor: 'var(--line)' }}>
      <td className="px-2 py-2 align-top" style={{ width: '34%' }}>
        <AccountPicker
          accounts={accounts}
          value={row.account_id}
          onChange={(id) => onChange({ account_id: id })}
          onAltC={onAltC ? () => onAltC(row.uid) : undefined}
        />
      </td>
      <td className="px-2 py-2 align-top" style={{ width: '24%' }}>
        {row.ref ? (
          <div
            className="inline-flex items-center gap-1.5 max-w-full px-2 py-1.5 rounded-md border text-xs"
            style={{
              background: 'rgba(15,157,154,0.08)',
              borderColor: 'rgba(15,157,154,0.30)',
              color: 'var(--brand)',
            }}
            title={`${row.ref.kind}: ${row.ref.label}`}
          >
            <button
              type="button"
              onClick={() => setRefOpen(true)}
              className="mono truncate hover:underline"
              style={{ color: 'var(--brand)' }}
            >
              {row.ref.label}
            </button>
            <button
              type="button"
              onClick={clearRef}
              className="p-0.5 rounded hover:opacity-80 flex-shrink-0"
              title="Clear reference"
              style={{ color: 'var(--brand)' }}
            >
              <X size={12} />
            </button>
          </div>
        ) : !row.party_id ? (
          // No party — only Advance / On-Account / Freeform make sense.
          <button
            type="button"
            onClick={() => setRefOpen(true)}
            className="inline-flex items-center gap-1.5 px-2 py-1.5 text-xs rounded-md border transition-colors hover:opacity-90"
            style={{
              background: 'var(--surface-0)',
              borderColor: 'var(--line)',
              color: 'var(--ink-3)',
            }}
            title="Pick a party first to see outstanding bills/invoices"
          >
            Other reference…
          </button>
        ) : (
          // Party set — auto-loaded outstanding bills as inline dropdown,
          // plus an escape hatch to the full sheet for Advance / On Account /
          // Freeform references.  Styled to match the input/picker primitives
          // used elsewhere on the row instead of a raw native <select>.
          <div className="relative">
            <select
              value=""
              onChange={(e) => {
                const v = e.target.value
                if (v === '__other__') setRefOpen(true)
                else if (v !== '') handlePendingPick(Number(v))
              }}
              disabled={pendingLoading}
              className="w-full h-9 pl-3 pr-9 text-xs border rounded-md outline-none transition-shadow focus:shadow-[0_0_0_3px_rgba(15,157,154,0.18)] appearance-none cursor-pointer disabled:cursor-wait"
              style={{
                background: 'var(--surface-0)',
                borderColor: 'var(--line)',
                color: pendingRefs.length === 0 ? 'var(--ink-3)' : 'var(--ink)',
              }}
              title={pendingRefs.length === 0
                ? 'No outstanding bills/invoices for this party'
                : `${pendingRefs.length} outstanding reference(s) — pick to allocate`}
            >
              <option value="" disabled>
                {pendingLoading
                  ? 'Loading references…'
                  : pendingRefs.length === 0
                    ? 'No outstanding refs'
                    : `${pendingRefs.length} outstanding ref${pendingRefs.length === 1 ? '' : 's'} — pick…`}
              </option>
              {pendingRefs.map((p, i) => (
                <option key={i} value={i}>{p.label}</option>
              ))}
              <option value="__other__">＋ Other reference (Advance / On Account / Freeform)…</option>
            </select>
            {/* Custom chevron — native arrows differ across browsers and clash
                with the AccountPicker on the same row. */}
            <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2">
              {pendingLoading
                ? <Loader2 size={12} className="animate-spin" style={{ color: 'var(--ink-3)' }} />
                : <ChevronDown size={14} style={{ color: 'var(--ink-3)' }} />}
            </span>
          </div>
        )}
      </td>
      <td className="px-2 py-2 align-top">
        <Input
          value={row.narration}
          onChange={(e) => onChange({ narration: e.target.value })}
          placeholder="Narration"
        />
      </td>
      <td className="px-2 py-2 align-top" style={{ width: '12rem' }}>
        <Input
          type="number"
          step="0.01"
          min="0"
          value={row.amount}
          onChange={(e) => onChange({ amount: e.target.value })}
          placeholder="0.00"
          className="text-right font-mono"
        />
      </td>
      <td className="px-1 py-2 w-8 align-middle">
        <button
          type="button"
          onClick={onRemove}
          disabled={removeDisabled}
          className="disabled:opacity-30 disabled:cursor-not-allowed p-1.5 rounded transition-colors"
          title="Remove line"
          style={{ color: 'var(--ink-3)' }}
          onMouseEnter={(e) => {
            if (!e.currentTarget.disabled) {
              e.currentTarget.style.color = 'var(--danger)'
              e.currentTarget.style.backgroundColor = 'var(--color-hover-bg)'
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = 'var(--ink-3)'
            e.currentTarget.style.backgroundColor = 'transparent'
          }}
        >
          <Trash2 size={14} />
        </button>

        <BillRefPickerSheet
          open={refOpen}
          onOpenChange={setRefOpen}
          partyType={row.party_type}
          partyId={row.party_id}
          partyName={selectedAccount?.account_name ?? ''}
          onPick={applyRef}
        />
      </td>
    </tr>
  )
}
