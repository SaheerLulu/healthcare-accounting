import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  BookOpen,
  Users,
  Landmark,
  Building2,
  FileBarChart,
  Receipt,
  Wallet,
  Loader2,
  ArrowRight,
  Package,
  type LucideIcon,
} from 'lucide-react'
import {
  getJournalEntries, getClosingStockRecon,
  type JournalEntry, type ClosingStockRecon,
} from '../lib/api'
import { formatDate, formatCurrency } from '../lib/utils'
import { useLocation as useActiveLocation } from '../contexts/LocationContext'
import { useHotkeyContext } from '../contexts/HotkeyContext'
import { usePageKeyboard } from '../hooks/usePageKeyboard'
import { useListKeyboardNav } from '../hooks/useListKeyboardNav'
import { Card } from '../components/ui/card'
import { voucherList } from './vouchers/voucherConfig'

const masters = [
  { label: 'Chart of Accounts', icon: BookOpen, to: '/accounts' },
  { label: 'Suppliers', icon: Users, to: '/parties/suppliers' },
  { label: 'Customers', icon: Users, to: '/parties/customers' },
  { label: 'Bank Accounts', icon: Landmark, to: '/banking' },
  { label: 'Fixed Assets', icon: Building2, to: '/fixed-assets' },
  { label: 'Loans & EMI', icon: Wallet, to: '/loans' },
]

const reports = [
  { label: 'Day Book', to: '/reports/daybook' },
  { label: 'Trial Balance', to: '/reports/trial-balance' },
  { label: 'Profit & Loss', to: '/reports/profit-loss' },
  { label: 'Balance Sheet', to: '/reports/balance-sheet' },
  { label: 'Outstanding Receivables', to: '/receivables' },
  { label: 'Outstanding Payables', to: '/payables' },
  { label: 'Cash Book', to: '/reports/cash-book' },
  { label: 'Bank Book', to: '/reports/bank-book' },
  { label: 'GST Computation', to: '/reports/gst-computation' },
  { label: 'HSN Summary', to: '/reports/hsn-summary' },
]

const VOUCHER_BG: Record<string, string> = {
  JOURNAL: 'bg-slate-100 text-slate-700',
  PURCHASE: 'bg-amber-50 text-amber-700',
  SALE: 'bg-emerald-50 text-emerald-700',
  PAYMENT: 'bg-rose-50 text-rose-700',
  RECEIPT: 'bg-sky-50 text-sky-700',
  CONTRA: 'bg-violet-50 text-violet-700',
  CREDIT_NOTE: 'bg-emerald-50 text-emerald-700',
  DEBIT_NOTE: 'bg-amber-50 text-amber-700',
}

const voucherLabel = (v: string) =>
  v.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())

function entryAmount(e: JournalEntry): number {
  let dr = 0
  for (const l of e.lines) dr += parseFloat(l.debit) || 0
  return dr
}

export default function GatewayPage() {
  const [recent, setRecent] = useState<JournalEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    getJournalEntries({ is_posted: 'true' })
      .then((res) => {
        if (cancelled) return
        setRecent((res.results || []).slice(0, 8))
      })
      .catch(() => { /* ignore */ })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  // Closing-stock reconciliation snapshot (books vs live inventory).
  const { activeLocationId } = useActiveLocation()
  const [stockRecon, setStockRecon] = useState<ClosingStockRecon | null>(null)
  const [stockLoading, setStockLoading] = useState(false)

  async function loadStock() {
    setStockLoading(true)
    try {
      setStockRecon(await getClosingStockRecon())
    } catch { /* ignore */ }
    finally { setStockLoading(false) }
  }
  useEffect(() => { loadStock() }, [activeLocationId])

  async function loadRecent() {
    try {
      const res = await getJournalEntries({ is_posted: 'true' })
      setRecent((res.results || []).slice(0, 8))
    } catch { /* ignore */ }
  }

  // ─── Keyboard ─────────────────────────────────────────────────────────────
  // Every grid on this page was a flat run of <Link>s: reaching the Reports
  // block meant ~30 Tab presses past the vouchers, the stock card and eight
  // recent entries. A roving tabindex per grid collapses each one to a single
  // tab stop with ↑↓/Home/End inside it. No onActivate is passed — these are
  // real links, and Enter already follows a focused link natively.
  const voucherNav = useListKeyboardNav({ count: voucherList.length })
  const recentNav = useListKeyboardNav({ count: recent.length })
  const mastersNav = useListKeyboardNav({ count: masters.length })
  const reportsNav = useListKeyboardNav({ count: reports.length })

  usePageKeyboard({
    actions: [
      { chord: 'Alt+R', label: 'Refresh', run: () => { loadRecent(); loadStock() } },
      { chord: 'Alt+M', label: 'Masters', run: mastersNav.focusList },
      { chord: 'Alt+T', label: 'Reports', run: reportsNav.focusList },
    ],
    onFocusList: voucherNav.focusList,
  })

  return (
    <div className="max-w-7xl mx-auto pb-8 md:pb-20">
      {/* Header — keyboard-only guidance, so it tracks the HotkeyBar breakpoint.
          Generated from the SAME hints the bottom bar shows, so it can never
          advertise a key this screen does not answer to. */}
      <div className="hidden md:block mb-6">
        <p className="text-sm" style={{ color: 'var(--ink-2)' }}>
          <PageHintLine />
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Vouchers — most prominent column */}
        <div className="lg:col-span-7">
          <SectionTitle icon={Receipt}>Vouchers</SectionTitle>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" {...voucherNav.containerProps}>
            {voucherList.map((v, i) => (
              <Link
                key={v.type}
                to={v.routePath}
                className="block group"
                // The keyboard focus ring for a non-<tr> row (index.css) paints
                // just outside this anchor and takes its radius from the parent,
                // which is a square grid cell — so the ring cut across the
                // corners of the rounded card inside. An inline radius wins over
                // that rule's `border-radius: inherit` and makes the ring hug the
                // card. Invisible otherwise: the anchor paints nothing itself.
                style={{ borderRadius: '0.75rem' }}
                // The gateway is where Ctrl+G and every F-key land, so it is
                // the screen that most needs somewhere useful to put focus:
                // PageTransition looks for [data-autofocus] on navigation.
                {...(i === 0 ? { 'data-autofocus': '' } : {})}
                {...voucherNav.rowProps(i)}
              >
                <Card
                  className="p-4 cursor-pointer hover:-translate-y-0.5 transition-transform"
                  style={{ borderColor: 'var(--line)', border: '1px solid var(--line)' }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-base font-semibold" style={{ color: 'var(--ink)' }}>
                        {v.label}
                      </div>
                      <div className="text-xs mt-0.5 truncate" style={{ color: 'var(--ink-2)' }}>
                        {v.description}
                      </div>
                    </div>
                    <span
                      className="mono text-xs font-bold px-2 py-1 rounded flex-shrink-0 hidden md:inline"
                      style={{
                        background: 'rgba(15,157,154,0.10)',
                        color: 'var(--brand)',
                        border: '1px solid rgba(15,157,154,0.20)',
                      }}
                    >
                      {v.fKey}
                    </span>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        </div>

        {/* Recent + Reports */}
        <div className="lg:col-span-5 space-y-5">
          {/* Stock snapshot */}
          <div>
            <SectionTitle icon={Package}>Stock</SectionTitle>
            <Card className="p-4">
              {stockLoading ? (
                <div className="text-center py-3">
                  <Loader2 size={16} className="animate-spin inline" style={{ color: 'var(--brand)' }} />
                </div>
              ) : !stockRecon ? (
                <div className="text-xs" style={{ color: 'var(--ink-3)' }}>
                  Stock data unavailable
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-3">
                    <Stat label="Books (1190)" value={formatCurrency(stockRecon.books_closing_stock)} />
                    <Stat label="Live Inventory" value={formatCurrency(stockRecon.inventory_value)} />
                    <Stat
                      label="Variance"
                      value={formatCurrency(stockRecon.variance)}
                      tone={parseFloat(stockRecon.variance) === 0 ? 'ok' : 'warn'}
                    />
                  </div>
                  {parseFloat(stockRecon.variance) !== 0 ? (
                    <Link
                      to="/sync"
                      className="text-[11px] text-center block py-1.5 rounded hover:underline"
                      style={{
                        background: 'rgba(229,153,40,0.10)',
                        color: 'var(--warning)',
                      }}
                    >
                      Variance — run a sync to post any pending opening-stock or purchase JVs →
                    </Link>
                  ) : (
                    <div
                      className="text-[11px] text-center py-1.5 rounded"
                      style={{
                        background: 'rgba(31,138,76,0.08)',
                        color: 'var(--success)',
                      }}
                    >
                      ✓ Books match physical inventory
                    </div>
                  )}
                  <div
                    className="flex items-center justify-between mt-2 text-[11px]"
                    style={{ color: 'var(--ink-3)' }}
                  >
                    <span>As of {stockRecon.as_of}</span>
                    <Link to="/reports/stock-summary" className="hover:underline" style={{ color: 'var(--brand)' }}>
                      Stock summary →
                    </Link>
                  </div>
                </>
              )}
            </Card>
          </div>

          {/* Recent vouchers */}
          <div>
            <SectionTitle icon={BookOpen}>Recent Vouchers</SectionTitle>
            <Card className="p-0 overflow-hidden">
              {loading ? (
                <div className="p-6 text-center">
                  <Loader2 className="animate-spin inline" size={18} style={{ color: 'var(--brand)' }} />
                </div>
              ) : recent.length === 0 ? (
                <div className="p-6 text-center text-sm" style={{ color: 'var(--ink-3)' }}>
                  No vouchers yet — press F5 to record your first payment
                </div>
              ) : (
                <ul {...recentNav.containerProps}>
                  {recent.map((e, i) => (
                    <li key={e.id} className="border-b last:border-0" style={{ borderColor: 'var(--line)' }}>
                      <Link
                        to={`/journals/${e.id}`}
                        className="flex flex-wrap items-center gap-x-2 gap-y-1 sm:gap-x-3 sm:gap-y-3 px-3 sm:px-4 py-2.5 hover:bg-[var(--color-hover-bg)] text-sm"
                        {...recentNav.rowProps(i)}
                      >
                        <span className="text-xs mono w-20 flex-shrink-0" style={{ color: 'var(--ink-3)' }}>
                          {formatDate(e.date)}
                        </span>
                        <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-medium flex-shrink-0 ${VOUCHER_BG[e.voucher_type] || 'bg-slate-100 text-slate-600'}`}>
                          {voucherLabel(e.voucher_type)}
                        </span>
                        {/* Below sm the amount drops to its own line rather than
                            squeezing the narration down to a couple of letters. */}
                        <span className="truncate flex-1 min-w-[6rem] sm:min-w-0" style={{ color: 'var(--ink)' }}>
                          {e.narration || e.entry_no}
                        </span>
                        <span className="font-mono text-xs flex-shrink-0 ml-auto" style={{ color: 'var(--ink-2)' }}>
                          {formatCurrency(entryAmount(e))}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              <Link
                to="/journals"
                className="block px-3 sm:px-4 py-2.5 text-xs hover:bg-[var(--color-hover-bg)] border-t"
                style={{ color: 'var(--brand)', borderColor: 'var(--line)' }}
              >
                View all journals <ArrowRight size={11} className="inline ml-0.5" />
              </Link>
            </Card>
          </div>

          {/* Masters */}
          <div>
            <SectionTitle icon={BookOpen}>Masters</SectionTitle>
            <Card className="p-3">
              <div className="grid grid-cols-2 gap-1" {...mastersNav.containerProps}>
                {masters.map((m, i) => (
                  <Link
                    key={m.label}
                    to={m.to}
                    className="flex items-center gap-2 px-2 py-2 rounded text-sm hover:bg-[var(--color-hover-bg)]"
                    style={{ color: 'var(--ink)' }}
                    {...mastersNav.rowProps(i)}
                  >
                    <m.icon size={14} style={{ color: 'var(--ink-3)' }} />
                    <span>{m.label}</span>
                  </Link>
                ))}
              </div>
            </Card>
          </div>

          {/* Reports */}
          <div>
            <SectionTitle icon={FileBarChart}>Reports</SectionTitle>
            <Card className="p-3">
              <div className="grid grid-cols-2 gap-1" {...reportsNav.containerProps}>
                {reports.map((r, i) => (
                  <Link
                    key={r.to}
                    to={r.to}
                    className="px-2 py-2.5 sm:py-1.5 rounded text-sm hover:bg-[var(--color-hover-bg)]"
                    style={{ color: 'var(--ink)' }}
                    {...reportsNav.rowProps(i)}
                  >
                    {r.label}
                  </Link>
                ))}
              </div>
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * The one-line keyboard prompt at the top of the gateway.
 *
 * It used to be a hand-written sentence, and it had drifted: it advertised
 * "Ctrl+A to save" on a screen with nothing to save and "Esc to back out"
 * with no Escape handler bound. Reading `pageHints` — the same list the
 * bottom HotkeyBar and the F1 sheet render — means the line can only ever
 * name keys this screen actually registered.
 */
function PageHintLine() {
  const { pageHints } = useHotkeyContext()
  const tail = pageHints.map((h) => `${h.chord} ${h.label.toLowerCase()}`).join(' · ')
  return <>Press an F-key to start a voucher{tail && ` · ${tail}`}</>
}

function Stat({ label, value, tone }: {
  label: string
  value: string
  tone?: 'ok' | 'warn'
}) {
  const color =
    tone === 'warn' ? 'var(--warning)' :
    tone === 'ok' ? 'var(--success)' : 'var(--ink)'
  return (
    <div>
      <div className="text-[10px] mono uppercase tracking-wider" style={{ color: 'var(--ink-3)' }}>
        {label}
      </div>
      <div className="text-sm font-mono font-semibold mt-0.5 truncate" style={{ color }}>
        {value}
      </div>
    </div>
  )
}

function SectionTitle({ icon: Icon, children }: { icon: LucideIcon; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <Icon size={14} style={{ color: 'var(--brand)' }} />
      <h2
        className="mono uppercase text-[11px] font-semibold tracking-wider"
        style={{ color: 'var(--ink-2)' }}
      >
        {children}
      </h2>
    </div>
  )
}
