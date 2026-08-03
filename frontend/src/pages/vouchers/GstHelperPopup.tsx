import { useEffect, useMemo, useState } from 'react'
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

  // Re-seed from the voucher each time the popup opens.
  useEffect(() => {
    if (open) {
      setTaxable(basePrefill)
      setSide(defaultSide)
    }
  }, [open, basePrefill, defaultSide])

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

  if (!open) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto overscroll-contain px-3 pt-6 pb-6 sm:px-4 sm:pt-24"
      style={{ background: 'rgba(0,0,0,0.35)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onOpenChange(false) }}
    >
      <div
        className="w-full max-w-lg rounded-xl border shadow-xl overflow-hidden"
        style={{ background: 'var(--surface-0)', borderColor: 'var(--line)' }}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b sm:px-5" style={{ borderColor: 'var(--line)' }}>
          <h3 className="text-sm font-semibold inline-flex items-center gap-2" style={{ color: 'var(--ink)' }}>
            <Calculator size={15} style={{ color: 'var(--brand)' }} /> Add GST
          </h3>
          <button onClick={() => onOpenChange(false)} className="p-1 rounded hover:bg-[var(--color-hover-bg)]" style={{ color: 'var(--ink-3)' }}>
            <X size={16} />
          </button>
        </div>

        <div className="p-4 space-y-4 sm:p-5">
          {/* Taxable amount */}
          <label className="block">
            <span className="block text-xs font-medium mb-1.5" style={{ color: 'var(--ink-2)' }}>Taxable amount</span>
            <Input
              type="number" inputMode="decimal" value={taxable}
              onChange={(e) => setTaxable(e.target.value)} placeholder="0.00" autoFocus
            />
          </label>

          {/* Rate chips + custom */}
          <div>
            <span className="block text-xs font-medium mb-1.5" style={{ color: 'var(--ink-2)' }}>GST rate</span>
            <div className="flex items-center gap-2 flex-wrap">
              {RATES.map((r) => (
                <button
                  key={r} type="button" onClick={() => setRate(r)}
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

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t sm:px-5" style={{ borderColor: 'var(--line)' }}>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={apply} disabled={!(base > 0) || !(rate > 0) || missing.length > 0}>
            <Calculator size={14} /> Insert lines
          </Button>
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
      <div className="flex rounded-lg border overflow-hidden" style={{ borderColor: 'var(--line)' }}>
        {options.map((o) => (
          <button
            key={String(o.v)} type="button" onClick={() => onChange(o.v)}
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
