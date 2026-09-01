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

/**
 * The typeable columns of the line grid, in tab order — feed these to
 * hooks/useGridKeyboardNav in the parent. The Dr/Cr toggle is deliberately
 * outside the grid: it is a radiogroup with its own arrow keys, not a cell
 * you type into.
 */
export const VOUCHER_LINE_COLUMNS = ['account', 'narration', 'amount']

/**
 * DOM id of one cell. useGridKeyboardNav addresses cells by id rather than by
 * ref because rows are re-keyed on every insert and delete — an id survives
 * that, a ref array does not. Parent and row must agree on the scheme, so it
 * lives here with the row that stamps it.
 */
export const voucherLineCellId = (row: number, col: string) => `ve-line-${row}-${col}`

export interface VoucherLineRowProps {
  line: VoucherLine
  accounts: Account[]
  accountFilter: (account: Account, side: LineSide) => boolean
  onChange: (patch: Partial<VoucherLine>) => void
  onRemove: () => void
  onAltC?: (lineUid: string) => void
  removeDisabled?: boolean
  /**
   * 0-based position in the grid. Supplying it stamps the cell ids and gives
   * every control a numbered accessible name; leaving it out keeps the row
   * exactly as it was, just tab-ordered.
   */
  rowIdx?: number
  /** Forwarded to the parent's useGridKeyboardNav — Tab/Enter cell movement. */
  onCellKeyDown?: (e: React.KeyboardEvent, colId: string) => void
  /** Row took focus: lets the parent remember which line Alt+D would delete. */
  onRowFocus?: () => void
}

/**
 * Single Tally-style voucher line:
 * [ Dr/Cr toggle ]  [ Account picker ]  [ Narration ]  [ Amount ]  [ × ]
 *
 * Keyboard model:
 *   ← →         switch Dr/Cr (one radiogroup, one tab stop)
 *   Tab         next cell — the parent's grid hook wraps it across rows
 *   Enter       same column, next row
 * The picker handles its own dropdown navigation and returns focus to the
 * trigger on close, so ledger → Tab → narration → Tab → amount keys straight
 * through without a detour to the top of the document.
 */
export function VoucherLineRow({
  line,
  accounts,
  accountFilter,
  onChange,
  onRemove,
  onAltC,
  removeDisabled,
  rowIdx,
  onCellKeyDown,
  onRowFocus,
}: VoucherLineRowProps) {
  const filteredAccounts = accounts.filter((a) => accountFilter(a, line.side))

  const cellId = (col: string) =>
    rowIdx === undefined ? undefined : voucherLineCellId(rowIdx, col)
  const lineLabel = rowIdx === undefined ? 'Line' : `Line ${rowIdx + 1}`

  /** Left/Right/Up/Down flip the side, the way a two-option radiogroup should. */
  function onSideKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return
    e.preventDefault()
    const next: LineSide = line.side === 'Dr' ? 'Cr' : 'Dr'
    onChange({ side: next })
    // Selection follows focus in a radiogroup, so move focus with it.
    const buttons = e.currentTarget.querySelectorAll<HTMLButtonElement>('button')
    buttons[next === 'Dr' ? 0 : 1]?.focus()
  }

  return (
    <tr className="border-b last:border-0" style={{ borderColor: 'var(--line)' }} onFocus={onRowFocus}>
      <td className="px-2 py-2 align-top w-20">
        <div
          role="radiogroup"
          aria-label={`${lineLabel} debit or credit`}
          onKeyDown={onSideKeyDown}
          className="flex gap-0.5 rounded-md border overflow-hidden"
          style={{ borderColor: 'var(--line)' }}
        >
          <SideButton
            label="Dr"
            title={`${lineLabel} — debit (By)`}
            active={line.side === 'Dr'}
            onClick={() => onChange({ side: 'Dr' })}
          />
          <SideButton
            label="Cr"
            title={`${lineLabel} — credit (To)`}
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
          triggerId={cellId('account')}
          ariaLabel={`${lineLabel} ledger`}
        />
      </td>
      <td className="px-2 py-2 align-top">
        <Input
          id={cellId('narration')}
          aria-label={`${lineLabel} narration`}
          value={line.narration}
          onChange={(e) => onChange({ narration: e.target.value })}
          onKeyDown={(e) => onCellKeyDown?.(e, 'narration')}
          placeholder="Particulars / narration"
        />
      </td>
      <td className="px-2 py-2 align-top w-36">
        <Input
          id={cellId('amount')}
          aria-label={`${lineLabel} amount`}
          type="number"
          step="0.01"
          min="0"
          value={line.amount}
          onChange={(e) => onChange({ amount: e.target.value })}
          onKeyDown={(e) => onCellKeyDown?.(e, 'amount')}
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
          className="disabled:opacity-30 disabled:cursor-not-allowed p-2.5 sm:p-1.5 rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--danger)]"
          // An icon-only control announces as "button" without this.
          aria-label={`Remove ${lineLabel.toLowerCase()}`}
          title="Remove line"
          style={{ color: 'var(--ink-3)' }}
          onFocus={(e) => { e.currentTarget.style.color = 'var(--danger)' }}
          onBlur={(e) => { e.currentTarget.style.color = 'var(--ink-3)' }}
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
  title,
  active,
  onClick,
}: {
  label: string
  title?: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      // Roving tabindex: the pair is ONE tab stop, ← → switch sides. Two stops
      // per line is a tax a ten-line voucher cannot afford.
      tabIndex={active ? 0 : -1}
      title={title}
      onClick={onClick}
      className="flex-1 px-2 py-2 sm:py-1 text-xs font-semibold mono transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--brand)]"
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
