import { Trash2 } from 'lucide-react'
import { AccountPicker } from '../journals/AccountPicker'
import { Input } from '../../components/ui/input'
import { cn } from '../../lib/utils'
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
    <tr className="border-b border-slate-100 last:border-0">
      <td className="px-2 py-2 align-top w-20">
        <div className="flex gap-0.5 rounded-md border border-slate-200 overflow-hidden">
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
          placeholder="0.00"
          className="text-right font-mono"
        />
      </td>
      <td className="px-1 py-2 w-8 align-middle">
        <button
          type="button"
          onClick={onRemove}
          disabled={removeDisabled}
          className="text-slate-400 hover:text-rose-600 disabled:opacity-30 disabled:cursor-not-allowed p-1.5 rounded hover:bg-slate-100"
          title="Remove line"
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
      className={cn(
        'flex-1 px-2 py-1 text-xs font-semibold mono transition-colors',
        active ? 'text-white' : 'text-slate-500 hover:bg-slate-50'
      )}
      style={active ? { background: 'var(--brand)' } : undefined}
    >
      {label}
    </button>
  )
}
