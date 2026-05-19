import { useState, useMemo } from 'react'
import { Trash2, FileText, X } from 'lucide-react'
import { AccountPicker } from '../journals/AccountPicker'
import { PartySearchPicker } from '../parties/PartySearchPicker'
import { Input } from '../../components/ui/input'
import type { Account, Party } from '../../lib/api'
import { BillRefPickerSheet, type BillRefValue } from './BillRefPickerSheet'

export interface PaymentRow {
  uid: string
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
  suppliers: Party[]
  customers: Party[]
  onChange: (patch: Partial<PaymentRow>) => void
  onRemove: () => void
  onAltC?: (uid: string) => void
  removeDisabled?: boolean
}

/**
 * Single row in the SimplePaymentVoucher table:
 * [ Party ] [ Ledger ] [ Reference ] [ Narration ] [ Amount ] [ × ]
 *
 * The row's party_type controls which list is shown in the picker. The parent
 * sets a row's party_type when it's created (from the header toggle) but a
 * user can still clear/change it inline.
 */
export function PaymentRowEditor({
  row, accounts, suppliers, customers,
  onChange, onRemove, onAltC, removeDisabled,
}: Props) {
  const [refOpen, setRefOpen] = useState(false)

  const partyList = row.party_type === 'Customer' ? customers : suppliers
  const selectedParty = useMemo(
    () => (row.party_id ? partyList.find((p) => p.id === row.party_id) ?? null : null),
    [row.party_id, partyList]
  )

  function setPartyId(id: number | '') {
    onChange({
      party_id: id === '' ? null : id,
      // Changing party invalidates the reference.
      ref: null,
    })
  }

  function clearRef() {
    onChange({ ref: null })
  }

  function applyRef(v: BillRefValue) {
    const patch: Partial<PaymentRow> = { ref: v }
    if (v.amount && (!row.amount || parseFloat(row.amount) === 0)) {
      patch.amount = v.amount
    }
    onChange(patch)
  }

  return (
    <tr className="border-b last:border-0" style={{ borderColor: 'var(--line)' }}>
      <td className="px-2 py-2 align-top" style={{ width: '18%' }}>
        {row.party_type ? (
          <PartySearchPicker
            parties={partyList}
            value={row.party_id ?? ''}
            onChange={setPartyId}
            storageKey={row.party_type}
            placeholder={`Search ${row.party_type.toLowerCase()}…`}
          />
        ) : (
          <span className="text-xs italic" style={{ color: 'var(--ink-3)' }}>—</span>
        )}
      </td>
      <td className="px-2 py-2 align-top" style={{ width: '22%' }}>
        <AccountPicker
          accounts={accounts}
          value={row.account_id}
          onChange={(id) => onChange({ account_id: id })}
          onAltC={onAltC ? () => onAltC(row.uid) : undefined}
        />
      </td>
      <td className="px-2 py-2 align-top" style={{ width: '22%' }}>
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
        ) : (
          <button
            type="button"
            onClick={() => setRefOpen(true)}
            className="inline-flex items-center gap-1.5 px-2 py-1.5 text-xs rounded-md border transition-colors hover:opacity-90"
            style={{
              background: 'var(--surface-0)',
              borderColor: 'var(--line)',
              color: 'var(--ink-2)',
            }}
          >
            <FileText size={12} /> Pick reference…
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
          partyName={selectedParty?.name ?? ''}
          onPick={applyRef}
        />
      </td>
    </tr>
  )
}
