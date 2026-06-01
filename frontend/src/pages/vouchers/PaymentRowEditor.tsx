import { useMemo, useState } from 'react'
import { Trash2, X, FileStack } from 'lucide-react'
import { AccountPicker } from '../journals/AccountPicker'
import { Input } from '../../components/ui/input'
import { type Account } from '../../lib/api'
import { BillRefPickerSheet, type BillRefValue } from './BillRefPickerSheet'
import { InvoiceAllocationGrid, type InvoiceAllocation } from './InvoiceAllocationGrid'

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

interface Props {
  row: PaymentRow
  accounts: Account[]
  onChange: (patch: Partial<PaymentRow>) => void
  onRemove: () => void
  onAltC?: (uid: string) => void
  /** Bubbles a multi-invoice bill-wise allocation up — the parent expands it
   *  into one settlement row per invoice. */
  onAllocate?: (items: InvoiceAllocation[]) => void
  removeDisabled?: boolean
}

/**
 * Single row in the SimplePaymentVoucher / SimpleReceiptVoucher table:
 * [ Ledger ] [ Reference ] [ Narration ] [ Amount ] [ × ]
 *
 * Each party IS a ledger now, so the row is driven by the Ledger picker — the
 * party is derived from it. When the ledger is a party ledger, "Settle invoices"
 * opens a bill-wise grid (one editable amount per outstanding invoice); the full
 * sheet stays available for Advance / On-Account / Freeform references.
 */
export function PaymentRowEditor({
  row, accounts, onChange, onRemove, onAltC, onAllocate, removeDisabled,
}: Props) {
  const [refOpen, setRefOpen] = useState(false)
  const [gridOpen, setGridOpen] = useState(false)

  const selectedAccount = useMemo(
    () => (row.account_id ? accounts.find((a) => a.id === row.account_id) ?? null : null),
    [row.account_id, accounts]
  )

  function clearRef() { onChange({ ref: null }) }

  function applyRef(v: BillRefValue) {
    const patch: Partial<PaymentRow> = { ref: v }
    if (v.amount && (!row.amount || parseFloat(row.amount) === 0)) patch.amount = v.amount
    onChange(patch)
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
        ) : row.party_id ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setGridOpen(true)}
              className="inline-flex items-center gap-1.5 px-2 py-1.5 text-xs rounded-md border transition-colors hover:opacity-90"
              style={{ background: 'rgba(15,157,154,0.08)', borderColor: 'rgba(15,157,154,0.30)', color: 'var(--brand)' }}
              title="See each outstanding invoice and enter how much to pay"
            >
              <FileStack size={12} /> Settle invoices…
            </button>
            <button
              type="button"
              onClick={() => setRefOpen(true)}
              className="text-xs hover:underline"
              style={{ color: 'var(--ink-3)' }}
              title="Advance / On-Account / Freeform reference"
            >
              Other…
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setRefOpen(true)}
            className="inline-flex items-center gap-1.5 px-2 py-1.5 text-xs rounded-md border transition-colors hover:opacity-90"
            style={{ background: 'var(--surface-0)', borderColor: 'var(--line)', color: 'var(--ink-3)' }}
          >
            Other reference…
          </button>
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
        {row.party_type && row.party_id && (
          <InvoiceAllocationGrid
            open={gridOpen}
            onOpenChange={setGridOpen}
            partyType={row.party_type}
            partyId={row.party_id}
            partyName={selectedAccount?.account_name ?? ''}
            onAllocate={(items) => onAllocate?.(items)}
          />
        )}
      </td>
    </tr>
  )
}
