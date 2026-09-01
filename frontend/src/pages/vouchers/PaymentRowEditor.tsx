import { useEffect, useMemo, useRef, useState } from 'react'
import { Trash2, X, FileStack } from 'lucide-react'
import { AccountPicker } from '../journals/AccountPicker'
import { Input } from '../../components/ui/input'
import { chordMatches } from '../../lib/shortcuts'
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
  /** Page-level Alt+B fallback — see the effect below. Bumped by the parent
   *  when the caret is outside the table and this is the row it picked. */
  openRefNonce?: number
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
  openRefNonce = 0,
}: Props) {
  const [refOpen, setRefOpen] = useState(false)
  const [gridOpen, setGridOpen] = useState(false)
  const rowRef = useRef<HTMLTableRowElement>(null)

  const selectedAccount = useMemo(
    () => (row.account_id ? accounts.find((a) => a.id === row.account_id) ?? null : null),
    [row.account_id, accounts]
  )

  /**
   * Alt+B pressed while the caret is OUTSIDE the line table.
   *
   * The row below owns the chord whenever focus is inside it, but from the
   * header or the footer only the page knows which line was last being keyed,
   * so it names the row (the same last-focused-row rule Alt+D uses) and bumps
   * this counter. Every bump is a fresh request, so asking twice for the same
   * row re-opens the picker; a row that was not asked for sees 0 and does
   * nothing.
   */
  useEffect(() => {
    if (openRefNonce > 0) setRefOpen(true)
  }, [openRefNonce])

  function clearRef() { onChange({ ref: null }) }

  function applyRef(v: BillRefValue) {
    const patch: Partial<PaymentRow> = { ref: v }
    if (v.amount && (!row.amount || parseFloat(row.amount) === 0)) patch.amount = v.amount
    onChange(patch)
  }

  /**
   * Alt+B opens THIS row's reference picker.
   *
   * It used to be Alt+R, which is wrong: Alt+R is "refresh" everywhere else in
   * the app (~50 screens bind it that way) and the chord map allows a canonical
   * chord exactly one meaning. Alt+B — bill reference — is free on every
   * voucher screen; the three screens that spell it differently (Bounce, Pay
   * bills, Deposit cash) are page-scoped and cannot be on screen at the same
   * time as a payment row.
   *
   * The chord is handled (and stopped) at the row rather than page-side because
   * only the row the caret sits in knows which line the picker belongs to — the
   * same reason the page tracks the focused row from the DOM for Alt+D. Being a
   * React handler it also sees keys from the AccountPicker's dropdown, which is
   * portalled to <body> but still a child of this row in the React tree.
   * Stopping propagation keeps the document-level listener from acting on the
   * same keystroke a second time. Matching goes through the shared chordMatches
   * so this row agrees with the rest of the app on what "Alt+B" is — modifiers
   * exact, Shift included.
   */
  function handleKeyDown(e: React.KeyboardEvent<HTMLTableRowElement>) {
    if (e.defaultPrevented || e.repeat) return
    // An open overlay owns the keyboard — the same rule HotkeyContext applies
    // to every registered chord, which this raw React handler has to enforce
    // itself. It matters here because BOTH of this row's overlays are rendered
    // inside the <tr>: their keystrokes are portalled to <body> but still
    // bubble to this handler through the React tree, and SheetContent only
    // intercepts Ctrl+S / Ctrl+Enter. Without this, Alt+B with the caret in an
    // allocation amount stacked the Bill Reference sheet on top of the grid.
    // The row sits at page depth, so ANY open overlay outranks it.
    if (refOpen || gridOpen) return
    if (document.querySelector('[role="dialog"][data-state="open"]')) return
    if (chordMatches('Alt+B', e.nativeEvent)) {
      e.preventDefault()
      e.stopPropagation()
      setRefOpen(true)
    }
  }

  /**
   * A bill-wise allocation replaces this row with one settlement row per
   * invoice, so the "Settle invoices…" button that opened the grid is gone by
   * the time Radix tries to restore focus to it and the caret is left on
   * <body> — dead keyboard. Remember the row's position first, then land the
   * caret on the amount of the first row generated in its place.
   */
  function handleAllocate(items: InvoiceAllocation[]) {
    const tr = rowRef.current
    const body = tr?.parentElement ?? null
    const index = tr && body ? Array.from(body.children).indexOf(tr) : -1
    onAllocate?.(items)
    if (!body || index < 0) return
    // Two frames: one for React to commit the replacement rows, one for the
    // sheet to finish the focus restore that can no longer find its trigger.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const active = document.activeElement as HTMLElement | null
      // Something already claimed the caret — don't yank it away.
      if (active && active !== document.body && active.isConnected) return
      const landed = body.children[index] as HTMLElement | undefined
      const target =
        landed?.querySelector<HTMLElement>('input[type="number"]:not([disabled])') ??
        landed?.querySelector<HTMLElement>(
          'input:not([disabled]), button:not([disabled]), select:not([disabled])',
        )
      target?.focus()
    }))
  }

  return (
    <tr
      ref={rowRef}
      onKeyDown={handleKeyDown}
      className="border-b last:border-0"
      style={{ borderColor: 'var(--line)' }}
    >
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
              className="mono truncate min-w-0 hover:underline"
              style={{ color: 'var(--brand)' }}
              aria-label={`Change reference ${row.ref.label} (Alt+B)`}
              aria-keyshortcuts="Alt+B"
              title="Change this reference (Alt+B)"
            >
              {row.ref.label}
            </button>
            <button
              type="button"
              onClick={clearRef}
              className="p-0.5 rounded hover:opacity-80 flex-shrink-0"
              title="Clear reference"
              aria-label={`Clear reference ${row.ref.label}`}
              style={{ color: 'var(--brand)' }}
            >
              <X size={12} />
            </button>
          </div>
        ) : row.party_id ? (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setGridOpen(true)}
              className="inline-flex items-center gap-1.5 px-2 py-2 sm:py-1.5 text-xs rounded-md border transition-colors hover:opacity-90"
              style={{ background: 'rgba(15,157,154,0.08)', borderColor: 'rgba(15,157,154,0.30)', color: 'var(--brand)' }}
              title="See each outstanding invoice and enter how much to pay"
              aria-label="Settle invoices — enter an amount against each outstanding invoice"
            >
              <FileStack size={12} /> Settle invoices…
            </button>
            <button
              type="button"
              onClick={() => setRefOpen(true)}
              className="text-xs hover:underline"
              style={{ color: 'var(--ink-3)' }}
              title="Advance / On-Account / Freeform reference (Alt+B)"
              aria-label="Other reference — advance, on-account or freeform (Alt+B)"
              aria-keyshortcuts="Alt+B"
            >
              Other…
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setRefOpen(true)}
            className="inline-flex items-center gap-1.5 px-2 py-2 sm:py-1.5 text-xs rounded-md border transition-colors hover:opacity-90"
            style={{ background: 'var(--surface-0)', borderColor: 'var(--line)', color: 'var(--ink-3)' }}
            title="Set a reference for this line (Alt+B)"
            aria-keyshortcuts="Alt+B"
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
          aria-label="Line narration"
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
          aria-label="Line amount"
          className="text-right font-mono"
        />
      </td>
      <td className="px-1 py-2 w-8 align-middle">
        <button
          type="button"
          onClick={onRemove}
          disabled={removeDisabled}
          className="disabled:opacity-30 disabled:cursor-not-allowed p-2.5 sm:p-1.5 rounded transition-colors"
          title="Remove line (Alt+D)"
          aria-label="Remove line"
          aria-keyshortcuts="Alt+D"
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
            onAllocate={handleAllocate}
          />
        )}
      </td>
    </tr>
  )
}
