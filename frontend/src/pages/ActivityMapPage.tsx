import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Loader2, BookOpen, ArrowRight } from 'lucide-react'
import { getAccountMappings, type AccountMapping } from '../lib/api'
import { Card } from '../components/ui/card'
import { Badge } from '../components/ui/badge'
import { usePageKeyboard } from '../hooks/usePageKeyboard'

/**
 * Activity → Account map. Documents every user-facing business activity
 * and the journal entry it produces, so non-accountants can trace exactly
 * which ledgers are touched on each save.
 */

type Side = 'Dr' | 'Cr'

interface JvLine {
  side: Side
  /** Semantic key from AccountMapping (e.g. 'TRADE_PAYABLES'). When unset
   *  the description shows in italics — for variable / contextual ledgers. */
  key?: string
  desc: string
}

interface Activity {
  name: string
  trigger: string
  area: string
  voucherType: string
  lines: JvLine[]
  notes?: string
  link?: { label: string; to: string }
}

const ACTIVITIES: Activity[] = [
  // ── Sales ─────────────────────────────────────────────────────────────────
  {
    area: 'Sales',
    name: 'POS Sale',
    trigger: 'Sync from inventory POS',
    voucherType: 'SALE',
    lines: [
      { side: 'Dr', key: 'CASH', desc: 'Cash (or Bank — by payment mode)' },
      { side: 'Cr', key: 'SALES_POS', desc: 'Sales — POS' },
      { side: 'Cr', key: 'OUTPUT_CGST', desc: 'Output CGST (intra-state)' },
      { side: 'Cr', key: 'OUTPUT_SGST', desc: 'Output SGST (intra-state)' },
      { side: 'Cr', key: 'OUTPUT_IGST', desc: 'Output IGST (inter-state)' },
    ],
  },
  {
    area: 'Sales',
    name: 'B2B Sale Invoice',
    trigger: 'Sync from inventory B2B sales',
    voucherType: 'SALE',
    lines: [
      { side: 'Dr', key: 'TRADE_RECEIVABLES', desc: 'Trade Receivables (vendor)' },
      { side: 'Cr', key: 'SALES_B2B', desc: 'Sales — B2B' },
      { side: 'Cr', key: 'OUTPUT_CGST', desc: 'Output CGST' },
      { side: 'Cr', key: 'OUTPUT_SGST', desc: 'Output SGST' },
      { side: 'Cr', key: 'OUTPUT_IGST', desc: 'Output IGST (inter-state)' },
    ],
  },
  {
    area: 'Sales',
    name: 'Sales Return / Credit Note',
    trigger: 'Sync from inventory sales return',
    voucherType: 'CREDIT_NOTE',
    lines: [
      { side: 'Dr', key: 'SALES_RETURNS', desc: 'Sales Returns (contra-revenue)' },
      { side: 'Dr', key: 'OUTPUT_CGST', desc: 'Reverse Output CGST' },
      { side: 'Dr', key: 'OUTPUT_SGST', desc: 'Reverse Output SGST' },
      { side: 'Cr', key: 'TRADE_RECEIVABLES', desc: 'Trade Receivables' },
    ],
  },
  {
    area: 'Sales',
    name: 'Customer Receipt (F6)',
    trigger: 'Receipt voucher from customer',
    voucherType: 'RECEIPT',
    lines: [
      { side: 'Dr', key: 'BANK', desc: 'Bank / Cash (by mode)' },
      { side: 'Cr', key: 'TRADE_RECEIVABLES', desc: 'Trade Receivables (customer)' },
    ],
    link: { label: 'Open F6', to: '/vouchers/receipt' },
  },
  {
    area: 'Sales',
    name: 'Discount Allowed',
    trigger: 'Manual JV or sales-line discount',
    voucherType: 'JOURNAL',
    lines: [
      { side: 'Dr', key: 'DISCOUNT_ALLOWED', desc: 'Discount Allowed' },
      { side: 'Cr', key: 'TRADE_RECEIVABLES', desc: 'Trade Receivables' },
    ],
  },
  {
    area: 'Sales',
    name: 'Customer Advance',
    trigger: 'Receipt voucher with no bill',
    voucherType: 'RECEIPT',
    lines: [
      { side: 'Dr', key: 'BANK', desc: 'Bank' },
      { side: 'Cr', key: 'CUSTOMER_ADVANCE', desc: 'Customer Advances' },
    ],
  },
  {
    area: 'Sales',
    name: 'Bad Debts Written Off',
    trigger: 'Closing entry → Bad Debts',
    voucherType: 'JOURNAL',
    lines: [
      { side: 'Dr', key: 'BAD_DEBTS_EXPENSE', desc: 'Bad Debts Expense' },
      { side: 'Cr', key: 'TRADE_RECEIVABLES', desc: 'Trade Receivables' },
    ],
    link: { label: 'Closing Entries', to: '/journals/closing-entries' },
  },

  // ── Purchases ─────────────────────────────────────────────────────────────
  {
    area: 'Purchases',
    name: 'Purchase Invoice',
    trigger: 'Sync from inventory purchase order',
    voucherType: 'PURCHASE',
    lines: [
      { side: 'Dr', key: 'PURCHASES', desc: 'Purchases' },
      { side: 'Dr', key: 'INPUT_CGST', desc: 'Input CGST' },
      { side: 'Dr', key: 'INPUT_SGST', desc: 'Input SGST' },
      { side: 'Dr', key: 'INPUT_IGST', desc: 'Input IGST (inter-state)' },
      { side: 'Cr', key: 'TRADE_PAYABLES', desc: 'Trade Payables (supplier)' },
    ],
  },
  {
    area: 'Purchases',
    name: 'Purchase Return / Debit Note',
    trigger: 'Sync from inventory purchase return',
    voucherType: 'DEBIT_NOTE',
    lines: [
      { side: 'Dr', key: 'TRADE_PAYABLES', desc: 'Trade Payables' },
      { side: 'Cr', key: 'PURCHASE_RETURNS', desc: 'Purchase Returns' },
      { side: 'Cr', key: 'INPUT_CGST', desc: 'Reverse Input CGST' },
      { side: 'Cr', key: 'INPUT_SGST', desc: 'Reverse Input SGST' },
    ],
  },
  {
    area: 'Purchases',
    name: 'Vendor Payment (F5)',
    trigger: 'Payment voucher to supplier',
    voucherType: 'PAYMENT',
    lines: [
      { side: 'Dr', key: 'TRADE_PAYABLES', desc: 'Trade Payables (supplier)' },
      { side: 'Cr', key: 'BANK', desc: 'Bank / Cash (by mode)' },
    ],
    link: { label: 'Open F5', to: '/vouchers/payment' },
  },
  {
    area: 'Purchases',
    name: 'Discount Received',
    trigger: 'Manual JV or vendor discount',
    voucherType: 'JOURNAL',
    lines: [
      { side: 'Dr', key: 'TRADE_PAYABLES', desc: 'Trade Payables' },
      { side: 'Cr', key: 'DISCOUNT_RECEIVED', desc: 'Discount Received' },
    ],
  },
  {
    area: 'Purchases',
    name: 'Supplier Advance',
    trigger: 'Payment voucher with no bill',
    voucherType: 'PAYMENT',
    lines: [
      { side: 'Dr', key: 'SUPPLIER_ADVANCE', desc: 'Advance to Suppliers' },
      { side: 'Cr', key: 'BANK', desc: 'Bank' },
    ],
  },
  {
    area: 'Purchases',
    name: 'RCM (Reverse Charge)',
    trigger: 'Auto on RCM-tagged purchase',
    voucherType: 'JOURNAL',
    lines: [
      { side: 'Dr', key: 'INPUT_CGST', desc: 'Input CGST under RCM' },
      { side: 'Dr', key: 'INPUT_SGST', desc: 'Input SGST under RCM' },
      { side: 'Cr', key: 'RCM_LIABILITY', desc: 'RCM GST Liability' },
    ],
  },

  // ── Stock & Inventory ────────────────────────────────────────────────────
  {
    area: 'Stock',
    name: 'Closing Stock JV',
    trigger: 'Period-end closing entries / Gateway sync',
    voucherType: 'JOURNAL',
    lines: [
      { side: 'Dr', key: 'CLOSING_STOCK', desc: 'Closing Stock' },
      { side: 'Cr', key: 'PURCHASES', desc: 'Purchases (offset)' },
    ],
    notes: 'Idempotent — re-running with the same value is a no-op.',
    link: { label: 'Sync from Gateway', to: '/' },
  },
  {
    area: 'Stock',
    name: 'Inventory Shrinkage / Damage',
    trigger: 'Closing entry → Shrinkage / Damage',
    voucherType: 'JOURNAL',
    lines: [
      { side: 'Dr', key: 'INVENTORY_LOSS', desc: 'Inventory Loss / Shrinkage' },
      { side: 'Dr', key: 'INPUT_CGST', desc: 'ITC reversal (if applicable)' },
      { side: 'Cr', key: 'CLOSING_STOCK', desc: 'Closing Stock' },
    ],
  },
  {
    area: 'Stock',
    name: 'Drug Expiry Write-off',
    trigger: 'Closing entry → Drug Expiry',
    voucherType: 'JOURNAL',
    lines: [
      { side: 'Dr', key: 'EXPIRY_LOSS', desc: 'Expired Stock Write-off' },
      { side: 'Dr', key: 'INPUT_CGST', desc: 'ITC reversal' },
      { side: 'Cr', key: 'CLOSING_STOCK', desc: 'Closing Stock' },
    ],
  },
  {
    area: 'Stock',
    name: 'Inter-Branch Stock Transfer',
    trigger: 'Closing entry → Stock Transfer',
    voucherType: 'JOURNAL',
    lines: [
      { side: 'Dr', key: 'STOCK_TRANSFER_TRANSIT', desc: 'Stock In Transit (receiving branch)' },
      { side: 'Cr', key: 'CLOSING_STOCK', desc: 'Closing Stock (sending branch)' },
    ],
    notes: 'Two JVs are posted (out + in) to keep both locations\' books in sync.',
  },

  // ── Banking ──────────────────────────────────────────────────────────────
  {
    area: 'Banking',
    name: 'Cash ↔ Bank Contra (F4)',
    trigger: 'Contra voucher',
    voucherType: 'CONTRA',
    lines: [
      { side: 'Dr', key: 'BANK', desc: 'Bank (or Cash — by direction)' },
      { side: 'Cr', key: 'CASH', desc: 'Cash (or Bank — by direction)' },
    ],
    link: { label: 'Open F4', to: '/vouchers/contra' },
  },
  {
    area: 'Banking',
    name: 'Cheque Cleared',
    trigger: 'Banking → Cheques → Clear',
    voucherType: 'JOURNAL',
    lines: [
      { side: 'Dr', key: 'CHEQUES_OUTSTANDING', desc: 'Cheques Issued (Outstanding)' },
      { side: 'Cr', key: 'BANK', desc: 'Bank (cleared on statement)' },
    ],
    notes: 'Cheque issuance already debited the payable; clearing just moves the liability into Bank.',
  },
  {
    area: 'Banking',
    name: 'Cheque Bounced + Bank Charge',
    trigger: 'Banking → Cheques → Bounce',
    voucherType: 'PAYMENT',
    lines: [
      { side: 'Dr', key: 'BANK_CHARGES', desc: 'Bank Charges' },
      { side: 'Cr', key: 'BANK', desc: 'Bank (charge deducted)' },
    ],
    notes: 'Plus an automatic reversal of the original payment voucher.',
  },
  {
    area: 'Banking',
    name: 'Bank Charges (statement)',
    trigger: 'Bank txn categorize',
    voucherType: 'PAYMENT',
    lines: [
      { side: 'Dr', key: 'BANK_CHARGES', desc: 'Bank Charges' },
      { side: 'Cr', key: 'BANK', desc: 'Bank' },
    ],
  },
  {
    area: 'Banking',
    name: 'Interest Received',
    trigger: 'Bank txn categorize (credit interest)',
    voucherType: 'RECEIPT',
    lines: [
      { side: 'Dr', key: 'BANK', desc: 'Bank' },
      { side: 'Cr', key: 'INTEREST_INCOME', desc: 'Interest Received' },
    ],
  },
  {
    area: 'Banking',
    name: 'Petty Cash Spend',
    trigger: 'Banking → Petty Cash → Spend',
    voucherType: 'PAYMENT',
    lines: [
      { side: 'Dr', desc: 'Selected expense account (e.g. Travel, Stationery)' },
      { side: 'Cr', key: 'PETTY_CASH', desc: 'Petty Cash' },
    ],
  },
  {
    area: 'Banking',
    name: 'Petty Cash Replenishment',
    trigger: 'Banking → Petty Cash → Replenish',
    voucherType: 'CONTRA',
    lines: [
      { side: 'Dr', key: 'PETTY_CASH', desc: 'Petty Cash' },
      { side: 'Cr', key: 'BANK', desc: 'Bank (or Cash)' },
    ],
  },

  // ── Loans & Fixed Assets ─────────────────────────────────────────────────
  {
    area: 'Loans & Assets',
    name: 'Loan Disbursement',
    trigger: 'Loans → Disburse',
    voucherType: 'RECEIPT',
    lines: [
      { side: 'Dr', key: 'BANK', desc: 'Bank' },
      { side: 'Cr', desc: 'Loan Liability (specific lender account)' },
    ],
  },
  {
    area: 'Loans & Assets',
    name: 'EMI Payment',
    trigger: 'Loans → Pay EMI',
    voucherType: 'PAYMENT',
    lines: [
      { side: 'Dr', desc: 'Loan Liability (principal portion)' },
      { side: 'Dr', key: 'INTEREST_EXPENSE', desc: 'Interest on Loans' },
      { side: 'Cr', key: 'BANK', desc: 'Bank' },
    ],
  },
  {
    area: 'Loans & Assets',
    name: 'Fixed Asset Acquisition',
    trigger: 'Fixed Assets → Post Acquisition',
    voucherType: 'PURCHASE',
    lines: [
      { side: 'Dr', desc: 'Fixed asset class account (e.g. Plant & Machinery)' },
      { side: 'Cr', key: 'BANK', desc: 'Bank (or Trade Payables)' },
    ],
  },
  {
    area: 'Loans & Assets',
    name: 'Depreciation Run',
    trigger: 'Fixed Assets → Post Depreciation',
    voucherType: 'JOURNAL',
    lines: [
      { side: 'Dr', key: 'DEPRECIATION_EXPENSE', desc: 'Depreciation Expense' },
      { side: 'Cr', desc: 'Accumulated Depreciation (per asset class)' },
    ],
  },
  {
    area: 'Loans & Assets',
    name: 'Asset Disposal',
    trigger: 'Fixed Assets → Dispose',
    voucherType: 'JOURNAL',
    lines: [
      { side: 'Dr', key: 'BANK', desc: 'Bank (proceeds)' },
      { side: 'Dr', desc: 'Accumulated Depreciation (clear)' },
      { side: 'Cr', desc: 'Asset class account (clear)' },
      { side: 'Cr', desc: 'Profit on Sale of Asset (or Dr Loss on Sale)' },
    ],
  },

  // ── Payroll ──────────────────────────────────────────────────────────────
  {
    area: 'Payroll',
    name: 'Salary Payable (Process)',
    trigger: 'Payroll → Process',
    voucherType: 'JOURNAL',
    lines: [
      { side: 'Dr', key: 'SALARY_EXPENSE', desc: 'Salary Expense (gross)' },
      { side: 'Cr', key: 'PF_PAYABLE', desc: 'PF Payable (employee + employer)' },
      { side: 'Cr', key: 'ESI_PAYABLE', desc: 'ESI Payable' },
      { side: 'Cr', key: 'PT_PAYABLE', desc: 'Professional Tax Payable' },
      { side: 'Cr', key: 'TDS_PAYABLE', desc: 'TDS on Salary' },
      { side: 'Cr', key: 'NET_SALARY_PAYABLE', desc: 'Net Salary Payable' },
    ],
  },
  {
    area: 'Payroll',
    name: 'Salary Paid',
    trigger: 'Payroll → Mark Paid',
    voucherType: 'PAYMENT',
    lines: [
      { side: 'Dr', key: 'NET_SALARY_PAYABLE', desc: 'Net Salary Payable' },
      { side: 'Cr', key: 'BANK', desc: 'Bank' },
    ],
  },

  // ── Tax / Compliance ─────────────────────────────────────────────────────
  {
    area: 'Tax',
    name: 'TDS Challan Deposit',
    trigger: 'TDS → Auto-generate Challan',
    voucherType: 'PAYMENT',
    lines: [
      { side: 'Dr', key: 'TDS_PAYABLE', desc: 'TDS Payable' },
      { side: 'Cr', key: 'BANK', desc: 'Bank' },
    ],
  },
  {
    area: 'Tax',
    name: 'TCS Challan Deposit',
    trigger: 'TDS → TCS Challan',
    voucherType: 'PAYMENT',
    lines: [
      { side: 'Dr', key: 'TCS_PAYABLE', desc: 'TCS Payable' },
      { side: 'Cr', key: 'BANK', desc: 'Bank' },
    ],
  },
  {
    area: 'Tax',
    name: 'GST Net Liability Settlement',
    trigger: 'GSTR-3B → File',
    voucherType: 'JOURNAL',
    lines: [
      { side: 'Dr', key: 'OUTPUT_CGST', desc: 'Clear Output CGST' },
      { side: 'Dr', key: 'OUTPUT_SGST', desc: 'Clear Output SGST' },
      { side: 'Cr', key: 'INPUT_CGST', desc: 'Setoff Input CGST' },
      { side: 'Cr', key: 'INPUT_SGST', desc: 'Setoff Input SGST' },
      { side: 'Cr', key: 'BANK', desc: 'Net cash payable' },
    ],
  },
  {
    area: 'Tax',
    name: 'GST Late Fee',
    trigger: 'GST late filing penalty',
    voucherType: 'PAYMENT',
    lines: [
      { side: 'Dr', key: 'GST_LATE_FEE', desc: 'GST Late Fee Expense' },
      { side: 'Cr', key: 'BANK', desc: 'Bank' },
    ],
  },

  // ── Period-end ───────────────────────────────────────────────────────────
  {
    area: 'Period-end',
    name: 'Provision for Bad Debts',
    trigger: 'Closing entry → Bad Debts Provision',
    voucherType: 'JOURNAL',
    lines: [
      { side: 'Dr', key: 'BAD_DEBTS_EXPENSE', desc: 'Bad Debts Expense' },
      { side: 'Cr', key: 'PROVISION_BAD_DEBTS', desc: 'Provision for Doubtful Debts' },
    ],
  },
  {
    area: 'Period-end',
    name: 'Round-off',
    trigger: 'Auto on invoices',
    voucherType: 'JOURNAL',
    lines: [
      { side: 'Dr', key: 'ROUND_OFF', desc: 'Round Off (when paise rounded down)' },
      { side: 'Cr', key: 'ROUND_OFF', desc: 'Round Off (when paise rounded up)' },
    ],
  },
]

const AREAS = ['Sales', 'Purchases', 'Stock', 'Banking', 'Loans & Assets', 'Payroll', 'Tax', 'Period-end']

/** DOM id of an area heading — also the jump target for Alt+↑ / Alt+↓. */
const areaId = (area: string) => `area-${area.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`

export default function ActivityMapPage() {
  const navigate = useNavigate()
  const [mappings, setMappings] = useState<AccountMapping[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    getAccountMappings()
      .then((m) => { if (!cancelled) setMappings(m) })
      .catch(() => { /* ignore */ })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const byKey = useMemo(() => {
    const out: Record<string, AccountMapping> = {}
    for (const m of mappings) out[m.key] = m
    return out
  }, [mappings])

  // Areas that actually render, in document order — the sequence Alt+↑ / Alt+↓ walk.
  const visibleAreas = useMemo(
    () => AREAS.filter((area) => ACTIVITIES.some((a) => a.area === area)),
    [],
  )

  /**
   * Jump to the previous / next area heading.
   *
   * This is a very long reference document with eight sections and no search,
   * so without a section key the only way to reach 'Payroll' from the top is
   * to scroll or Tab through everything above it. The headings are real <h2>s
   * carrying tabIndex={-1}, so focus lands on the heading itself — a screen
   * reader announces the section it just moved to.
   */
  const jumpArea = useCallback((delta: number) => {
    if (visibleAreas.length === 0) return
    const headings = visibleAreas
      .map((area) => document.getElementById(areaId(area)))
      .filter((el): el is HTMLElement => !!el)
    if (headings.length === 0) return
    const current = headings.findIndex((el) => el.contains(document.activeElement))
    // Nothing focused inside a section yet: start from whichever heading the
    // viewport is showing, so Alt+↓ continues the read rather than restarting.
    // `fallback` is the first heading still below the top edge, so the section
    // being read is the one before it — and `fallback === 0` means the reader
    // is ABOVE the first section, which has to stay distinct from being IN it:
    // clamping that to 0 made Alt+↓ from a freshly loaded page skip 'Sales'.
    const fallback = headings.findIndex((el) => el.getBoundingClientRect().top > 8)
    const from =
      current >= 0 ? current
      : fallback < 0 ? headings.length - 1  // scrolled past every heading
      : fallback - 1                        // -1 = above the first section
    const next = Math.max(0, Math.min(headings.length - 1, from + delta))
    headings[next].focus()
    headings[next].scrollIntoView({ block: 'start' })
  }, [visibleAreas])

  usePageKeyboard({
    actions: [
      { chord: 'Alt+Down', label: 'Next area', run: () => jumpArea(1) },
      { chord: 'Alt+Up', label: 'Previous area', run: () => jumpArea(-1) },
    ],
    onBack: () => navigate(-1),
  })

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      <div className="flex items-baseline gap-2 flex-wrap">
        <BookOpen size={18} style={{ color: 'var(--brand)' }} />
        <h1 className="text-xl font-semibold" style={{ color: 'var(--ink)', letterSpacing: '-0.01em' }}>
          Activity → Account Map
        </h1>
        <span className="text-sm" style={{ color: 'var(--ink-2)' }}>
          · Every operation in the app and the journal entry it creates
        </span>
      </div>

      <Card className="p-4 text-sm" style={{ background: 'var(--surface-1)' }}>
        <p style={{ color: 'var(--ink-2)' }}>
          Each row below shows a real action (a button click in the app, a sync from
          inventory, or a period-end task) and the JV that hits the books. Account
          codes shown in the right column come from your{' '}
          <Link to="/settings" className="hover:underline" style={{ color: 'var(--brand)' }}>
            account mappings
          </Link>
          . If any row says <em>not mapped</em>, fix it from{' '}
          <Link to="/setup" className="hover:underline" style={{ color: 'var(--brand)' }}>
            Setup Checklist (F11)
          </Link>
          .
        </p>
      </Card>

      {loading ? (
        <div className="text-center py-12">
          <Loader2 size={20} className="animate-spin inline" style={{ color: 'var(--brand)' }} />
        </div>
      ) : (
        visibleAreas.map((area) => {
          const items = ACTIVITIES.filter((a) => a.area === area)
          return (
            <div key={area}>
              {/* A real heading, and focusable from Alt+↑ / Alt+↓ — tabIndex={-1}
                  keeps it out of the Tab order while letting the chord land on it. */}
              <h2
                id={areaId(area)}
                tabIndex={-1}
                className="mono uppercase text-[11px] font-semibold tracking-wider mb-2 focus:outline-none"
                style={{ color: 'var(--ink-3)' }}
              >
                {area}
              </h2>
              <Card className="p-0 overflow-hidden">
                {items.map((act, i) => (
                  <ActivityRow
                    key={act.name}
                    activity={act}
                    last={i === items.length - 1}
                    byKey={byKey}
                  />
                ))}
              </Card>
            </div>
          )
        })
      )}
    </div>
  )
}

function ActivityRow({ activity, last, byKey }: {
  activity: Activity
  last: boolean
  byKey: Record<string, AccountMapping>
}) {
  // Only a rail that actually scrolls earns a Tab stop — the same measurement
  // components/ui/table.tsx makes for every other table in the app. This page
  // renders one rail per activity, and at any desktop width none of them
  // overflows: an unconditional tabIndex turned every one of them into a dead
  // Tab stop on a page that otherwise has a handful.
  const railRef = useRef<HTMLDivElement>(null)
  const [scrollable, setScrollable] = useState(false)
  useEffect(() => {
    const el = railRef.current
    if (!el) return
    const measure = () => setScrollable(el.scrollWidth > el.clientWidth + 1)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    const table = el.querySelector('table')
    if (table) ro.observe(table)
    return () => ro.disconnect()
  }, [])

  return (
    <div
      className={last ? 'p-4' : 'p-4 border-b'}
      style={!last ? { borderColor: 'var(--line)' } : undefined}
    >
      <div className="flex items-start justify-between gap-3 mb-2 flex-wrap">
        <div>
          <div className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
            {activity.name}
          </div>
          <div className="text-xs mt-0.5" style={{ color: 'var(--ink-2)' }}>
            Trigger: <span style={{ color: 'var(--ink)' }}>{activity.trigger}</span>
            <span className="mx-2" style={{ color: 'var(--ink-3)' }}>·</span>
            Voucher type: <Badge variant="default" className="ml-0.5">{activity.voucherType}</Badge>
          </div>
        </div>
        {activity.link && (
          <Link
            to={activity.link.to}
            className="inline-flex items-center gap-0.5 text-xs hover:underline"
            style={{ color: 'var(--brand)' }}
          >
            {activity.link.label} <ArrowRight size={11} />
          </Link>
        )}
      </div>
      <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--line)' }}>
        {/* The rail scrolls sideways below ~560px, and the account-code column
            — the point of this page — is the part that goes off-screen. A
            scroll container is only keyboard-scrollable once it is focusable. */}
        <div
          ref={railRef}
          // The wrapper above is `overflow-hidden`, which clips a plain outline
          // — so the rail uses the inset ring the shared table primitive uses,
          // and only while it is focusable at all.
          className="table-scroll focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--brand)]"
          tabIndex={scrollable ? 0 : undefined}
          role={scrollable ? 'region' : undefined}
          aria-label={scrollable ? `${activity.name} — journal lines` : undefined}
        >
          <table className="w-full text-xs min-w-[560px]">
            <tbody>
              {activity.lines.map((l, i) => {
                const mapping = l.key ? byKey[l.key] : null
                return (
                  <tr key={i} className={i < activity.lines.length - 1 ? 'border-b' : ''} style={{ borderColor: 'var(--line)' }}>
                    <td className="px-3 py-1.5 mono font-bold w-12" style={{ color: l.side === 'Dr' ? 'var(--success)' : 'var(--danger)' }}>
                      {l.side}
                    </td>
                    <td className="px-3 py-1.5" style={{ color: 'var(--ink)' }}>
                      {l.desc}
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      {mapping ? (
                        <span className="mono text-[11px]" style={{ color: 'var(--ink-2)' }}>
                          <span style={{ color: 'var(--brand)' }}>{mapping.account_code}</span> {mapping.account_name}
                        </span>
                      ) : l.key ? (
                        <span className="text-[11px] italic" style={{ color: 'var(--warning)' }}>
                          not mapped
                        </span>
                      ) : (
                        <span className="text-[11px] italic" style={{ color: 'var(--ink-3)' }}>
                          contextual
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
      {activity.notes && (
        <div className="text-[11px] mt-2" style={{ color: 'var(--ink-3)' }}>
          {activity.notes}
        </div>
      )}
    </div>
  )
}
