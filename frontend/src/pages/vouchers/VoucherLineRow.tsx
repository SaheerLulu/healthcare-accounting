import { Trash2 } from 'lucide-react'
import { AccountPicker } from '../journals/AccountPicker'
import { Input } from '../../components/ui/input'
import type { Account } from '../../lib/api'
import type { LineSide } from './voucherConfig'

export interface VoucherLine {
  uid: string
  side: LineSide
  account: number | null
  amount: string
  narration: string
}

export interface VoucherLineRowProps {
  line: VoucherLine
  accounts: Account[]
  accountFilter: (account: Account, side: LineSide) => boolean
  onChange: (patch: Partial<VoucherLine>) => void
  onRemove: () => void
  onAltC?: (lineUid: string) => void
  removeDisabled?: boolean
}

/**
 * Single Tally-style voucher line:
 * [ Dr/Cr toggle ]  [ Account picker ]  [ Narration ]  [ Amount ]  [ × ]
 *
 * Tab order is left-to-right; the picker handles its own keyboard navigation.
 */
export function VoucherLineRow({
  line,
  accounts,
  accountFilter,
  onChange,
  onRemove,
  onAltC,
  removeDisabled,
}: VoucherLineRowProps) {
  const filteredAccounts = accounts.filter((a) => accountFilter(a, line.side))

  return (
    <tr className="border-b last:border-0" style={{ borderColor: 'var(--line)' }}>
      <td className="px-2 py-2 align-top w-20">
        <div className="flex gap-0.5 rounded-md border overflow-hidden" style={{ borderColor: 'var(--line)' }}>
          <SideButton
            label="Dr"
            active={line.side === 'Dr'}
            onClick={() => onChange({ side: 'Dr' })}
          />
          <SideButton
            label="Cr"
            active={line.side === 'Cr'}
            onClick={() => onChange({ side: 'Cr' })}
          />
        </div>
      </td>
      <td className="px-2 py-2 align-top">
        <AccountPicker
          accounts={filteredAccounts}
          value={line.account}
          onChange={(id) => onChange({ account: id })}
          onAltC={onAltC ? () => onAltC(line.uid) : undefined}
        />
      </td>
      <td className="px-2 py-2 align-top">
        <Input
          value={line.narration}
          onChange={(e) => onChange({ narration: e.target.value })}
          placeholder="Particulars / narration"
        />
      </td>
      <td className="px-2 py-2 align-top w-36">
        <Input
          type="number"
          step="0.01"
          min="0"
          value={line.amount}
          onChange={(e) => onChange({ amount: e.target.value })}
          onBlur={() => {
            // Quantize to 2dp — the backend stores paisa-precision Decimals
            // and rejects >2dp; '10.005' would otherwise 400 on save.
            const n = parseFloat(line.amount)
            if (Number.isFinite(n)) onChange({ amount: n.toFixed(2) })
          }}
          placeholder="0.00"
          className="text-right font-mono"
        />
      </td>
      <td className="px-1 py-2 w-8 align-middle">
        <button
          type="button"
          onClick={onRemove}
          disabled={removeDisabled}
          className="disabled:opacity-30 disabled:cursor-not-allowed p-2.5 sm:p-1.5 rounded transition-colors"
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
      </td>
    </tr>
  )
}

function SideButton({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex-1 px-2 py-2 sm:py-1 text-xs font-semibold mono transition-colors"
      style={active
        ? { background: 'var(--brand)', color: '#fff' }
        : { background: 'transparent', color: 'var(--ink-2)' }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.backgroundColor = 'var(--color-hover-bg)'
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.backgroundColor = 'transparent'
      }}
    >
      {label}
    </button>
  )
}
