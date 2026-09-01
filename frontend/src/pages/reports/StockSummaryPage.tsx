import { forwardRef, useMemo, useRef, useState, type FormEvent, type RefObject } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, Search, X } from 'lucide-react'
import { toast } from 'sonner'
import {
  getStockMovement, getStockValuation,
  type StockMovementRow, type StockValuationRow,
} from '../../lib/api'
import { formatCurrency, getCurrentFY } from '../../lib/utils'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../../components/ui/tabs'
import { Input } from '../../components/ui/input'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { Table, Thead, Tbody, Tr, Th, Td } from '../../components/ui/table'
import { usePageKeyboard } from '../../hooks/usePageKeyboard'
import { useListKeyboardNav } from '../../hooks/useListKeyboardNav'

/** Case-insensitive substring match on the product name. */
function filterByProduct<T extends { product_name: string }>(rows: T[], query: string): T[] {
  const q = query.trim().toLowerCase()
  if (!q) return rows
  return rows.filter((r) => (r.product_name || '').toLowerCase().includes(q))
}

type ListNav = ReturnType<typeof useListKeyboardNav>

/**
 * Product filter for both tabs.
 *
 * Each report arrives as one unpaginated payload, so this narrows the rows
 * already in memory — no request, and so nothing to debounce. It composes with
 * the date filters above it rather than replacing them: those choose which
 * report to fetch, this chooses which of its rows to show.
 *
 * The ref is forwarded so the page can make it the F2 target; Escape inside it
 * is the shared `Input` contract (clear, then blur), not a rule of this screen.
 *
 * It sits inside the report's filter form to share that row's layout, and a
 * bare Enter in a form's text input implicitly submits the form — which re-ran
 * the whole report and swapped the table the user was reading for a spinner.
 * Filtering needs no request, so Enter here is swallowed; Alt+R still runs the
 * report, and chorded Enter is left alone.
 */
const ProductSearch = forwardRef<HTMLInputElement, { value: string; onChange: (v: string) => void }>(
  function ProductSearch({ value, onChange }, ref) {
    return (
      <div className="relative w-full sm:w-64">
        <Search
          className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
          style={{ color: 'var(--ink-3)' }}
        />
        <Input
          ref={ref}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Search products…"
          aria-label="Search products by name"
          aria-keyshortcuts="F2"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.altKey) e.preventDefault()
          }}
          className="pl-8 pr-8"
        />
        {value && (
          <button
            type="button"
            onClick={() => onChange('')}
            aria-label="Clear product search"
            aria-keyshortcuts="Alt+C"
            className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-[var(--color-hover-bg)]"
            style={{ color: 'var(--ink-3)' }}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    )
  },
)

function NoProductsFound({ colSpan, query, onClear }: { colSpan: number; query: string; onClear: () => void }) {
  return (
    <tr>
      <td colSpan={colSpan} className="text-center py-12 text-sm" style={{ color: 'var(--ink-3)' }}>
        No products found for “{query}”.{' '}
        <button type="button" onClick={onClear} className="hover:underline" style={{ color: 'var(--brand)' }}>
          Clear search
        </button>
      </td>
    </tr>
  )
}

interface MovementTabProps {
  rows: StockMovementRow[]
  visible: StockMovementRow[]
  loading: boolean
  fetched: boolean
  dateFrom: string
  dateTo: string
  search: string
  setDateFrom: (v: string) => void
  setDateTo: (v: string) => void
  setSearch: (v: string) => void
  onRun: (e?: FormEvent) => void
  fromRef: RefObject<HTMLInputElement>
  searchRef: RefObject<HTMLInputElement>
  nav: ListNav
}

function StockMovementTab({
  rows, visible, loading, fetched, dateFrom, dateTo, search,
  setDateFrom, setDateTo, setSearch, onRun, fromRef, searchRef, nav,
}: MovementTabProps) {
  return (
    <div>
      {/* A form, so Enter from a date field runs the report — the button used
          to be the only way to fire it. */}
      <form className="flex flex-wrap items-center gap-3 mb-5" onSubmit={onRun}>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <label htmlFor="stock-movement-from" className="text-xs text-slate-500 font-medium">From</label>
          <Input id="stock-movement-from" ref={fromRef} data-autofocus type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-full sm:w-auto px-2.5 py-1.5" />
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <label htmlFor="stock-movement-to" className="text-xs text-slate-500 font-medium">To</label>
          <Input id="stock-movement-to" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-full sm:w-auto px-2.5 py-1.5" />
        </div>
        <Button type="submit" chord="Alt+R" className="w-full sm:w-auto" disabled={loading}>
          {loading && <Loader2 size={14} className="animate-spin" />}
          Run Report
        </Button>
        {fetched && <ProductSearch ref={searchRef} value={search} onChange={setSearch} />}
      </form>

      <div className="sr-only" role="status" aria-live="polite">
        {loading ? 'Loading stock movement…' : fetched ? `${visible.length} products` : ''}
      </div>

      <Card className="overflow-hidden">
        <Table label="Stock movement" aria-busy={loading}>
          <Thead>
            <Tr className="bg-slate-50">
              <Th>Product</Th>
              <Th>HSN</Th>
              <Th className="text-right">Opening</Th>
              <Th className="text-right">Inward</Th>
              <Th className="text-right">Outward</Th>
              <Th className="text-right">Closing</Th>
            </Tr>
          </Thead>
          <Tbody {...nav.containerProps}>
            {loading ? (
              <tr><td colSpan={6} className="text-center py-12"><Loader2 size={24} className="animate-spin inline text-teal-600" /></td></tr>
            ) : !fetched ? (
              <tr><td colSpan={6} className="text-center py-12 text-slate-400 text-sm">Select date range and run report</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={6} className="text-center py-12 text-slate-400 text-sm">No stock movement data</td></tr>
            ) : visible.length === 0 ? (
              <NoProductsFound colSpan={6} query={search.trim()} onClear={() => setSearch('')} />
            ) : visible.map((row, i) => (
              <Tr key={row.product_id} {...nav.rowProps(i)}>
                <Td className="font-medium text-sm">{row.product_name}</Td>
                <Td className="text-xs text-slate-500 font-mono">{row.hsn_code || '-'}</Td>
                <Td className="text-right font-mono text-sm">{row.opening_qty}</Td>
                <Td className="text-right font-mono text-sm text-emerald-600">{row.inward_qty > 0 ? `+${row.inward_qty}` : '-'}</Td>
                <Td className="text-right font-mono text-sm text-red-600">{row.outward_qty > 0 ? `-${row.outward_qty}` : '-'}</Td>
                <Td className="text-right font-mono text-sm font-semibold">{row.closing_qty}</Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      </Card>
    </div>
  )
}

interface ValuationTabProps {
  rows: StockValuationRow[]
  visible: StockValuationRow[]
  loading: boolean
  fetched: boolean
  asOfDate: string
  search: string
  shownValue: string | number
  isFiltered: boolean
  setAsOfDate: (v: string) => void
  setSearch: (v: string) => void
  onRun: (e?: FormEvent) => void
  dateRef: RefObject<HTMLInputElement>
  searchRef: RefObject<HTMLInputElement>
  nav: ListNav
}

function StockValuationTab({
  rows, visible, loading, fetched, asOfDate, search, shownValue, isFiltered,
  setAsOfDate, setSearch, onRun, dateRef, searchRef, nav,
}: ValuationTabProps) {
  return (
    <div>
      <form className="flex flex-wrap items-center gap-3 mb-5" onSubmit={onRun}>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <label htmlFor="stock-valuation-date" className="text-xs text-slate-500 font-medium">As of</label>
          <Input id="stock-valuation-date" ref={dateRef} type="date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} className="w-full sm:w-auto px-2.5 py-1.5" />
        </div>
        <Button type="submit" chord="Alt+R" className="w-full sm:w-auto" disabled={loading}>
          {loading && <Loader2 size={14} className="animate-spin" />}
          Run Report
        </Button>
        {fetched && <ProductSearch ref={searchRef} value={search} onChange={setSearch} />}
        {fetched && (
          <span className="w-full sm:w-auto ml-auto text-sm text-slate-600">
            {isFiltered ? 'Value of matches' : 'Total Value'}:{' '}
            <span className="font-mono font-semibold text-slate-900">{formatCurrency(shownValue)}</span>
          </span>
        )}
      </form>

      <div className="sr-only" role="status" aria-live="polite">
        {loading
          ? 'Loading stock valuation…'
          : fetched
            ? `${visible.length} products, value ${formatCurrency(shownValue)}`
            : ''}
      </div>

      <Card className="overflow-hidden">
        <Table label="Stock valuation" aria-busy={loading}>
          <Thead>
            <Tr className="bg-slate-50">
              <Th>Product</Th>
              <Th>HSN</Th>
              <Th className="text-right">Closing Qty</Th>
              <Th className="text-right">Avg Rate</Th>
              <Th className="text-right">Value</Th>
            </Tr>
          </Thead>
          <Tbody {...nav.containerProps}>
            {loading ? (
              <tr><td colSpan={5} className="text-center py-12"><Loader2 size={24} className="animate-spin inline text-teal-600" /></td></tr>
            ) : !fetched ? (
              <tr><td colSpan={5} className="text-center py-12 text-slate-400 text-sm">Select date and run report</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={5} className="text-center py-12 text-slate-400 text-sm">No stock data</td></tr>
            ) : visible.length === 0 ? (
              <NoProductsFound colSpan={5} query={search.trim()} onClear={() => setSearch('')} />
            ) : visible.map((row, i) => (
              <Tr key={row.product_id} {...nav.rowProps(i)}>
                <Td className="font-medium text-sm">{row.product_name}</Td>
                <Td className="text-xs text-slate-500 font-mono">{row.hsn_code || '-'}</Td>
                <Td className="text-right font-mono text-sm">{row.closing_qty}</Td>
                <Td className="text-right font-mono text-sm">{formatCurrency(row.avg_rate)}</Td>
                <Td className="text-right font-mono text-sm font-semibold">{formatCurrency(row.value)}</Td>
              </Tr>
            ))}
          </Tbody>
          {fetched && visible.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
                <td colSpan={4} className="py-3 px-4 text-sm text-slate-500">
                  {isFiltered
                    ? `Matching ${visible.length} of ${rows.length} products`
                    : `Total (${rows.length} products)`}
                </td>
                <td className="py-3 px-4 text-right font-mono text-sm">{formatCurrency(shownValue)}</td>
              </tr>
            </tfoot>
          )}
        </Table>
      </Card>
    </div>
  )
}

type TabId = 'movement' | 'valuation'

/**
 * Both reports' state lives here rather than inside the tab panels.
 *
 * Radix unmounts the inactive panel, so panel-local state meant that arrowing
 * across the tab strip threw away rows that had already been fetched and made
 * the user re-run the report. It is also what lets ONE keyboard contract
 * describe the screen: hints and chords are registered per page (the hint
 * register holds a single set), so the page has to know which tab is showing.
 */
export default function StockSummaryPage() {
  const navigate = useNavigate()
  const fy = getCurrentFY()
  const [tab, setTab] = useState<TabId>('movement')

  // Movement tab
  const [mRows, setMRows] = useState<StockMovementRow[]>([])
  const [mLoading, setMLoading] = useState(false)
  const [mFetched, setMFetched] = useState(false)
  const [mFrom, setMFrom] = useState(fy.start)
  const [mTo, setMTo] = useState(fy.end)
  const [mSearch, setMSearch] = useState('')
  const mFromRef = useRef<HTMLInputElement>(null)
  const mSearchRef = useRef<HTMLInputElement>(null)

  // Valuation tab
  const [vRows, setVRows] = useState<StockValuationRow[]>([])
  const [vTotalValue, setVTotalValue] = useState('0.00')
  const [vLoading, setVLoading] = useState(false)
  const [vFetched, setVFetched] = useState(false)
  const [vAsOf, setVAsOf] = useState(new Date().toISOString().split('T')[0])
  const [vSearch, setVSearch] = useState('')
  const vDateRef = useRef<HTMLInputElement>(null)
  const vSearchRef = useRef<HTMLInputElement>(null)

  const mVisible = useMemo(() => filterByProduct(mRows, mSearch), [mRows, mSearch])
  const vVisible = useMemo(() => filterByProduct(vRows, vSearch), [vRows, vSearch])
  const vIsFiltered = vVisible.length !== vRows.length
  // The server's total covers every product, so once a search narrows the list
  // it would contradict the rows on screen. Re-sum what is actually shown.
  const vShownValue = useMemo(
    () => (vIsFiltered
      ? vVisible.reduce((s, r) => s + (parseFloat(r.value) || 0), 0)
      : vTotalValue),
    [vIsFiltered, vVisible, vTotalValue],
  )

  async function loadMovement(e?: FormEvent) {
    e?.preventDefault()
    setMLoading(true)
    try {
      const res = await getStockMovement({ start_date: mFrom, end_date: mTo })
      setMRows(res.rows)
      setMFetched(true)
    } catch { toast.error('Failed to load stock movement') }
    finally { setMLoading(false) }
  }

  async function loadValuation(e?: FormEvent) {
    e?.preventDefault()
    setVLoading(true)
    try {
      const res = await getStockValuation({ date: vAsOf })
      setVRows(res.rows)
      setVTotalValue(res.total_value)
      setVFetched(true)
    } catch { toast.error('Failed to load stock valuation') }
    finally { setVLoading(false) }
  }

  // ─── Keyboard ──────────────────────────────────────────────────────────────
  // Read-only registers: no onActivate, but ↑↓/Home/End/PgUp/PgDn walk the
  // products through a single roving tab stop, so Tab still steps clean past a
  // thousand-row valuation.
  const mNav = useListKeyboardNav({ count: mVisible.length })
  const vNav = useListKeyboardNav({ count: vVisible.length })

  const isMovement = tab === 'movement'
  // F2 goes to the product search once there are rows to filter; before the
  // first run that box does not exist, so it goes to the date instead.
  const searchRef = isMovement
    ? (mFetched ? mSearchRef : mFromRef)
    : (vFetched ? vSearchRef : vDateRef)
  const search = isMovement ? mSearch : vSearch

  usePageKeyboard({
    actions: [
      {
        chord: 'Alt+R',
        label: 'Run report',
        run: () => (isMovement ? loadMovement() : loadValuation()),
        when: !(isMovement ? mLoading : vLoading),
      },
      {
        chord: 'Alt+C',
        label: 'Clear search',
        run: () => (isMovement ? setMSearch('') : setVSearch('')),
        when: search.trim().length > 0,
      },
      // hintOnly, as on PartyDetailPage: TabsTrigger owns the handler so the
      // switch goes through onValueChange, and these entries only advertise.
      // The keycap is `hidden lg:inline-block`, so below that width the hint
      // bar is the ONLY thing that names them.
      { chord: 'Alt+1', label: 'Stock movement', hintOnly: true, run: () => {} },
      { chord: 'Alt+2', label: 'Stock valuation', hintOnly: true, run: () => {} },
    ],
    searchRef,
    onFocusList: isMovement ? mNav.focusList : vNav.focusList,
    onBack: () => navigate(-1),
  })

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      <div className="mb-6">
        <h1 className="text-lg sm:text-xl font-semibold" style={{ color: "var(--ink)", letterSpacing: "-0.01em" }}>Stock Summary</h1>
        <p className="text-sm mt-0.5" style={{ color: "var(--ink-2)" }}>Inventory movement and valuation reports</p>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as TabId)}>
        {/* Each trigger carries a chord, so the other report is reachable from
            deep inside a thousand-row table without Shift+Tabbing back out to
            the strip; the keycap on the trigger is what advertises it. */}
        <TabsList label="Stock reports">
          <TabsTrigger value="movement" chord="Alt+1">Stock Movement</TabsTrigger>
          <TabsTrigger value="valuation" chord="Alt+2">Stock Valuation</TabsTrigger>
        </TabsList>
        <TabsContent value="movement">
          <StockMovementTab
            rows={mRows}
            visible={mVisible}
            loading={mLoading}
            fetched={mFetched}
            dateFrom={mFrom}
            dateTo={mTo}
            search={mSearch}
            setDateFrom={setMFrom}
            setDateTo={setMTo}
            setSearch={setMSearch}
            onRun={loadMovement}
            fromRef={mFromRef}
            searchRef={mSearchRef}
            nav={mNav}
          />
        </TabsContent>
        <TabsContent value="valuation">
          <StockValuationTab
            rows={vRows}
            visible={vVisible}
            loading={vLoading}
            fetched={vFetched}
            asOfDate={vAsOf}
            search={vSearch}
            shownValue={vShownValue}
            isFiltered={vIsFiltered}
            setAsOfDate={setVAsOf}
            setSearch={setVSearch}
            onRun={loadValuation}
            dateRef={vDateRef}
            searchRef={vSearchRef}
            nav={vNav}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}
