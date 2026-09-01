import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Calculator } from 'lucide-react'
import { toast } from 'sonner'
import type { Account } from '../../lib/api'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { formatCurrency } from '../../lib/utils'
import { cn } from '../../lib/utils'

export type GstSide = 'input' | 'output'

/** key → resolved ChartOfAccount id (location-aware; null when unmapped). */
export interface GstLedgers {
  INPUT_CGST: number | null
  INPUT_SGST: number | null
  INPUT_IGST: number | null
  OUTPUT_CGST: number | null
  OUTPUT_SGST: number | null
  OUTPUT_IGST: number | null
}

export interface GstInsertLine {
  side: 'Dr' | 'Cr'
  account: number
  amount: string
  narration: string
}

const RATES = [5, 12, 18, 28]

function round2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

export function GstHelperPopup({
  open, onOpenChange, accounts, ledgers, defaultSide, basePrefill, onInsert,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  accounts: Account[]
  ledgers: GstLedgers
  defaultSide: GstSide
  basePrefill: string
  onInsert: (lines: GstInsertLine[]) => void
}) {
  const [taxable, setTaxable] = useState(basePrefill)
  const [rate, setRate] = useState(18)
  const [inter, setInter] = useState(false) // false = intra (CGST+SGST)
  const [side, setSide] = useState<GstSide>(defaultSide)
  const [balanceAcct, setBalanceAcct] = useState<number | ''>('')
  const panelRef = useRef<HTMLDivElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)

  // Re-seed from the voucher each time the popup opens.
  useEffect(() => {
    if (open) {
      setTaxable(basePrefill)
      setSide(defaultSide)
    }
  }, [open, basePrefill, defaultSide])

  /**
   * Remember what opened the popup, land the caret on the entry field, and hand
   * focus back on the way out. This is not a Radix dialog, so nothing else does
   * any of it and closing would otherwise strand the user on <body> in the
   * middle of a voucher.
   *
   * All three live in one effect because the ORDER is the whole point. The
   * taxable field used to carry `autoFocus`, which React applies from
   * commitMount in the commit's LAYOUT phase — before any passive effect, and
   * before this component's own layout effect too, since children commit
   * first. So an effect that read `document.activeElement` never saw the
   * opener; it saw this popup's own input, and the restore on close was a
   * no-op. Reading the opener first and focusing the field second, from here,
   * is the only ordering that holds. `data-autofocus` stays the marker for
   * which field that is, exactly as DialogContent/SheetContent use it.
   */
  useEffect(() => {
    if (!open) return
    const opener = document.activeElement as HTMLElement | null
    returnFocusRef.current = opener && opener !== document.body ? opener : null
    const root = panelRef.current
    const target =
      root?.querySelector<HTMLElement>('[data-autofocus]') ??
      root?.querySelector<HTMLElement>(
        'input:not([type="hidden"]):not([disabled]), select:not([disabled])',
      )
    target?.focus()
    return () => {
      const el = returnFocusRef.current
      const active = document.activeElement as HTMLElement | null
      // Only when closing left the caret nowhere — the voucher may have moved
      // it onto the lines this popup just inserted, and that wins.
      if (active && active !== document.body && active.isConnected) return
      if (el && el.isConnected) el.focus()
    }
  }, [open])

  const base = parseFloat(taxable) || 0
  const tax = round2((base * rate) / 100)
  const cgst = round2(tax / 2)
  const sgst = round2(tax - cgst)
  const gross = round2(base + tax)
  const halfRate = Number((rate / 2).toFixed(2))

  const settlementAccounts = useMemo(
    () => accounts
      .filter((a) => a.is_active !== false && a.is_leaf !== false)
      .sort((a, b) => a.account_code.localeCompare(b.account_code)),
    [accounts],
  )

  function acctLabel(id: number | null) {
    if (id == null) return null
    const a = accounts.find((x) => x.id === id)
    return a ? `${a.account_code} ${a.account_name}` : `#${id}`
  }

  // Which GST ledgers this side+supply will hit, for the live preview.
  const taxSide: 'Dr' | 'Cr' = side === 'input' ? 'Dr' : 'Cr'
  const balSide: 'Dr' | 'Cr' = side === 'input' ? 'Cr' : 'Dr'
  const prefix = side === 'input' ? 'Input' : 'Output'
  const previewTax = inter
    ? [{
        key: side === 'input' ? 'INPUT_IGST' : 'OUTPUT_IGST',
        label: `${prefix} IGST @${rate}%`, amount: tax,
        id: side === 'input' ? ledgers.INPUT_IGST : ledgers.OUTPUT_IGST,
      }]
    : [
        {
          key: side === 'input' ? 'INPUT_CGST' : 'OUTPUT_CGST',
          label: `${prefix} CGST @${halfRate}%`, amount: cgst,
          id: side === 'input' ? ledgers.INPUT_CGST : ledgers.OUTPUT_CGST,
        },
        {
          key: side === 'input' ? 'INPUT_SGST' : 'OUTPUT_SGST',
          label: `${prefix} SGST @${halfRate}%`, amount: sgst,
          id: side === 'input' ? ledgers.INPUT_SGST : ledgers.OUTPUT_SGST,
        },
      ]

  const missing = previewTax.filter((p) => p.id == null)

  function apply() {
    if (!(base > 0)) { toast.error('Enter a taxable amount'); return }
    if (!(rate > 0)) { toast.error('Enter a GST rate'); return }
    if (missing.length > 0) {
      toast.error(`${prefix} ${inter ? 'IGST' : 'CGST/SGST'} ledger not mapped — set it in Settings → Account Mappings`)
      return
    }
    const lines: GstInsertLine[] = previewTax.map((p) => ({
      side: taxSide, account: p.id as number,
      amount: p.amount.toFixed(2), narration: p.label,
    }))
    if (balanceAcct) {
      lines.push({
        side: balSide, account: Number(balanceAcct),
        amount: gross.toFixed(2), narration: '',
      })
    }
    onInsert(lines)
    onOpenChange(false)
  }

  /**
   * This overlay is hand-rolled rather than a Radix dialog, so the three things
   * Radix would have done have to be done here:
   *
   *  1. Escape closes it. A field with something in it clears first — `Input`
   *     stops that keystroke itself, so the popup only sees the second press,
   *     which is the app-wide Escape contract.
   *  2. Chords stop at the popup. Ctrl+A behind this is "save & post", and it
   *     is allow-listed, so without this it posted the voucher from inside the
   *     helper. Ctrl+S / Ctrl+Enter insert instead, and a bare Enter in a field
   *     does too — the two numbers this popup is made of are both inputs.
   *  3. Tab stays inside. Nothing else traps focus, so Tab off the last control
   *     walked into the voucher underneath.
   */
  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.defaultPrevented) return
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onOpenChange(false)
      return
    }
    if (e.key === 'Tab') {
      trapTab(e)
      return
    }
    const target = e.target as HTMLElement | null
    const isCommit =
      ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S' || e.key === 'Enter')) ||
      (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.altKey && target?.tagName === 'INPUT')
    if (isCommit) {
      e.preventDefault()
      e.stopPropagation()
      apply()
      return
    }
    // Swallowed, not defaulted: Ctrl+A still selects the field's text, it just
    // no longer posts the voucher underneath.
    if (e.ctrlKey || e.metaKey || e.altKey) e.stopPropagation()
  }

  function trapTab(e: React.KeyboardEvent) {
    const root = panelRef.current
    if (!root) return
    const items = Array.from(
      root.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((el) => el.offsetParent !== null || el === document.activeElement)
    if (items.length === 0) return
    const first = items[0]
    const last = items[items.length - 1]
    const active = document.activeElement as HTMLElement | null
    if (e.shiftKey && (active === first || !root.contains(active))) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && (active === last || !root.contains(active))) {
      e.preventDefault()
      first.focus()
    }
  }

  if (!open) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto overscroll-contain px-3 pt-6 pb-6 sm:px-4 sm:pt-24"
      style={{ background: 'rgba(0,0,0,0.35)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onOpenChange(false) }}
      onKeyDown={handleKeyDown}
    >
      <div
        ref={panelRef}
        /* `role="dialog"` + `data-state="open"` are what the app's shared
           Escape guards look for (lib/shortcuts.ts, useEscapeBack). Without
           them this popup was invisible to them and one Escape closed the
           helper AND ran the voucher's discard/back handler behind it. */
        role="dialog"
        aria-modal="true"
        data-state="open"
        aria-labelledby="gst-helper-title"
        className="w-full max-w-lg rounded-xl border shadow-xl overflow-hidden"
        style={{ background: 'var(--surface-0)', borderColor: 'var(--line)' }}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b sm:px-5" style={{ borderColor: 'var(--line)' }}>
          <h3 id="gst-helper-title" className="text-sm font-semibold inline-flex items-center gap-2" style={{ color: 'var(--ink)' }}>
            <Calculator size={15} style={{ color: 'var(--brand)' }} /> Add GST
          </h3>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="p-1 rounded hover:bg-[var(--color-hover-bg)]"
            style={{ color: 'var(--ink-3)' }}
            aria-label="Close GST helper"
            aria-keyshortcuts="Escape"
            title="Close (Esc)"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-4 space-y-4 sm:p-5">
          {/* Taxable amount */}
          <label className="block">
            <span className="block text-xs font-medium mb-1.5" style={{ color: 'var(--ink-2)' }}>Taxable amount</span>
            <Input
              type="number" inputMode="decimal" value={taxable}
              onChange={(e) => setTaxable(e.target.value)} placeholder="0.00"
              /* Focused by the effect above, not by `autoFocus`: the attribute
                 fires in the commit's layout phase, i.e. before the effect that
                 has to record which control opened the popup. */
              data-autofocus
            />
          </label>

          {/* Rate chips + custom */}
          <div>
            <span className="block text-xs font-medium mb-1.5" style={{ color: 'var(--ink-2)' }}>GST rate</span>
            <div className="flex items-center gap-2 flex-wrap" role="group" aria-label="GST rate">
              {RATES.map((r) => (
                <button
                  key={r} type="button" onClick={() => setRate(r)}
                  aria-pressed={rate === r}
                  className={cn('px-3 py-1.5 text-sm rounded-lg border transition-colors')}
                  style={{
                    background: rate === r ? 'var(--brand)' : 'var(--surface-0)',
                    color: rate === r ? '#fff' : 'var(--ink)',
                    borderColor: rate === r ? 'var(--brand)' : 'var(--line)',
                  }}
                >{r}%</button>
              ))}
              <div className="flex items-center gap-1">
                <input
                  type="number" inputMode="decimal" value={rate}
                  aria-label="Custom GST rate, percent"
                  onChange={(e) => setRate(parseFloat(e.target.value) || 0)}
                  className="w-20 h-9 px-2 text-sm border rounded-lg outline-none focus:shadow-[0_0_0_3px_rgba(15,157,154,0.18)]"
                  style={{ background: 'var(--surface-0)', borderColor: 'var(--line)', color: 'var(--ink)' }}
                />
                <span className="text-sm" style={{ color: 'var(--ink-3)' }}>%</span>
              </div>
            </div>
          </div>

          {/* Supply + side toggles */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Toggle
              label="Supply"
              options={[{ v: false, t: 'Intra (CGST+SGST)' }, { v: true, t: 'Inter (IGST)' }]}
              value={inter} onChange={setInter}
            />
            <Toggle
              label="Tax side"
              options={[{ v: 'input', t: 'Input (purchase)' }, { v: 'output', t: 'Output (sale)' }]}
              value={side} onChange={setSide}
            />
          </div>

          {/* Balancing account */}
          <label className="block">
            <span className="block text-xs font-medium mb-1.5" style={{ color: 'var(--ink-2)' }}>
              Balancing account <span style={{ color: 'var(--ink-3)' }}>· optional, posts the gross {formatCurrency(gross)} on the {balSide} side</span>
            </span>
            <select
              value={balanceAcct}
              onChange={(e) => setBalanceAcct(e.target.value ? Number(e.target.value) : '')}
              className="w-full h-9 px-3 text-sm border rounded-lg outline-none focus:shadow-[0_0_0_3px_rgba(15,157,154,0.18)]"
              style={{ background: 'var(--surface-0)', borderColor: 'var(--line)', color: 'var(--ink)' }}
            >
              <option value="">— none (I'll add the settlement line) —</option>
              {settlementAccounts.map((a) => (
                <option key={a.id} value={a.id}>{a.account_code} — {a.account_name}</option>
              ))}
            </select>
          </label>

          {/* Live preview */}
          <div className="rounded-lg border p-3 text-sm" style={{ borderColor: 'var(--line)', background: 'var(--surface-1)' }}>
            <div className="text-[11px] uppercase tracking-wide mb-2" style={{ color: 'var(--ink-3)' }}>Will insert</div>
            <div className="space-y-1 font-mono text-xs">
              {previewTax.map((p) => (
                <div key={p.key} className="flex items-center justify-between gap-2">
                  <span className="min-w-0 break-words" style={{ color: p.id == null ? 'var(--danger)' : 'var(--ink-2)' }}>
                    {acctLabel(p.id) ?? `${p.label} — not mapped`}
                  </span>
                  <span className="shrink-0" style={{ color: 'var(--ink)' }}>{taxSide} {p.amount.toFixed(2)}</span>
                </div>
              ))}
              {balanceAcct ? (
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 break-words" style={{ color: 'var(--ink-2)' }}>{acctLabel(Number(balanceAcct))}</span>
                  <span className="shrink-0" style={{ color: 'var(--ink)' }}>{balSide} {gross.toFixed(2)}</span>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-t sm:px-5" style={{ borderColor: 'var(--line)' }}>
          {/* The popup's keys, said out loud. It cannot reach the page hint bar
              without wiping the voucher's own hints, so it advertises here. */}
          <span className="text-[11px]" style={{ color: 'var(--ink-3)' }}>
            <kbd className="mono">Enter</kbd> or <kbd className="mono">Ctrl+S</kbd> insert ·{' '}
            <kbd className="mono">Esc</kbd> cancel
          </span>
          <div className="flex items-center gap-2 ml-auto">
            <Button variant="secondary" onClick={() => onOpenChange(false)} aria-keyshortcuts="Escape">Cancel</Button>
            <Button
              onClick={apply}
              disabled={!(base > 0) || !(rate > 0) || missing.length > 0}
              aria-keyshortcuts="Control+S"
            >
              <Calculator size={14} /> Insert lines
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function Toggle<T>({ label, options, value, onChange }: {
  label: string
  options: { v: T; t: string }[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div>
      <span className="block text-xs font-medium mb-1.5" style={{ color: 'var(--ink-2)' }}>{label}</span>
      <div className="flex rounded-lg border overflow-hidden" style={{ borderColor: 'var(--line)' }} role="group" aria-label={label}>
        {options.map((o) => (
          <button
            key={String(o.v)} type="button" onClick={() => onChange(o.v)}
            aria-pressed={value === o.v}
            className="flex-1 px-2 py-1.5 text-xs transition-colors"
            style={{
              background: value === o.v ? 'rgba(15,157,154,0.12)' : 'var(--surface-0)',
              color: value === o.v ? 'var(--brand)' : 'var(--ink-2)',
              fontWeight: value === o.v ? 600 : 400,
            }}
          >{o.t}</button>
        ))}
      </div>
    </div>
  )
}
