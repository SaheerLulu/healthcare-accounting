import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Loader2, ExternalLink } from 'lucide-react'
import { toast } from 'sonner'
import { getLedgerPage, type LedgerReport } from '../../lib/api'
import { formatCurrency, formatDate, getCurrentFY } from '../../lib/utils'
import { Card } from '../../components/ui/card'
import { Input } from '../../components/ui/input'
import { Button } from '../../components/ui/button'
import { Pagination } from '../../components/ui/Pagination'
import { Table, Thead, Tbody, Tr, Th, Td } from '../../components/ui/table'

const DEFAULT_PAGE_SIZE = 200 // backend LedgerPagination.max_page_size

/**
 * Ledger drill-down for a single Chart-of-Accounts row. Opens at
 * /reports/ledger/:code and lists the posted JV lines that touched the
 * account, with running balance and links back to the source journal entry.
 *
 * Always requests a page (page_size <= 200): the unpaginated endpoint
 * materialises the WHOLE ledger — multi-MB responses on busy accounts.
 * The backend returns the period opening balance on every page and running
 * balances seeded from the rows before the page, so pages stitch together
 * exactly like the old full response.
 */
export default function LedgerPage() {
  const { code } = useParams<{ code: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const fy = getCurrentFY()
  const initialFrom = searchParams.get('from') || fy.start
  const initialTo = searchParams.get('to') || fy.end

  const [dateFrom, setDateFrom] = useState(initialFrom)
  const [dateTo, setDateTo] = useState(initialTo)
  const [report, setReport] = useState<LedgerReport | null>(null)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [loading, setLoading] = useState(true)

  async function load(targetPage = page, size = pageSize) {
    if (!code) return
    setLoading(true)
    try {
      const res = await getLedgerPage({
        account_code: code,
        start_date: dateFrom,
        end_date: dateTo,
        page: String(targetPage),
        page_size: String(size),
      })
      setReport(res.results)
      setTotal(res.count)
      setPage(targetPage)
      setPageSize(size)
    } catch (err) {
      const e = err as { response?: { data?: { error?: string } } }
      toast.error(e.response?.data?.error || 'Failed to load ledger')
      setReport(null)
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load(1) /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [code])

  function applyDates() {
    setSearchParams({ from: dateFrom, to: dateTo })
    load(1)
  }

  if (!code) {
    return (
      <div className="p-12 text-center text-sm" style={{ color: 'var(--ink-3)' }}>
        No account code specified.
      </div>
    )
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const isLastPage = page >= totalPages
  const txns = report?.transactions ?? []
  // On pages after the first, the period opening row is replaced by the
  // balance brought forward into this page (first row balance net of its
  // own movement).
  const broughtForward = txns.length > 0
    ? parseFloat(String(txns[0].balance)) -
      (parseFloat(String(txns[0].debit)) || 0) +
      (parseFloat(String(txns[0].credit)) || 0)
    : null

  return (
    <div className="max-w-7xl mx-auto space-y-4">
      <button
        onClick={() => navigate('/accounts')}
        className="inline-flex items-center gap-1 text-sm hover:opacity-80"
        style={{ color: 'var(--ink-2)' }}
      >
        <ArrowLeft size={14} /> Chart of Accounts
      </button>

      <div>
        <h1 className="text-xl font-semibold" style={{ color: 'var(--ink)', letterSpacing: '-0.01em' }}>
          Ledger · {report?.account.name ?? code}
        </h1>
        <p className="text-sm mt-0.5" style={{ color: 'var(--ink-2)' }}>
          <span className="mono">{report?.account.code ?? code}</span>
          {report?.account.type && <span> · {report.account.type}</span>}
        </p>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium mono uppercase" style={{ color: 'var(--ink-2)', letterSpacing: '0.08em' }}>From</label>
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-auto" />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium mono uppercase" style={{ color: 'var(--ink-2)', letterSpacing: '0.08em' }}>To</label>
          <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-auto" />
        </div>
        <Button onClick={applyDates} disabled={loading}>
          {loading && <Loader2 size={14} className="animate-spin" />}
          Apply
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={28} className="animate-spin" style={{ color: 'var(--brand)' }} />
        </div>
      ) : !report ? (
        <Card className="p-12 text-center text-sm" style={{ color: 'var(--ink-3)' }}>
          No data available for this account.
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Opening" value={formatCurrency(report.opening_balance)} />
            <Stat label="Transactions" value={total.toLocaleString()} mono />
            <Stat
              label={isLastPage ? 'Closing' : `Balance · pg ${page}/${totalPages}`}
              value={formatCurrency(report.closing_balance)}
              tone={isLastPage && parseFloat(String(report.closing_balance)) === 0 ? 'muted' : 'default'}
            />
          </div>

          <Card className="overflow-hidden p-0">
            <div className="overflow-x-auto">
            <Table>
              <Thead>
                <Tr>
                  <Th className="text-left">Date</Th>
                  <Th className="text-left">Voucher #</Th>
                  <Th className="text-left">Type</Th>
                  <Th className="text-left">Source Doc</Th>
                  <Th className="text-left">Narration</Th>
                  <Th className="text-right px-3">Debit</Th>
                  <Th className="text-right px-3">Credit</Th>
                  <Th className="text-right px-3">Balance</Th>
                </Tr>
              </Thead>
              <Tbody>
                <Tr>
                  <Td colSpan={7} className="text-sm" style={{ color: 'var(--ink-3)' }}>
                    {page === 1 ? 'Opening balance' : 'Balance brought forward'}
                  </Td>
                  <Td className="text-right mono px-3" style={{ color: 'var(--ink-2)' }}>
                    {page === 1
                      ? formatCurrency(report.opening_balance)
                      : broughtForward !== null ? formatCurrency(broughtForward) : '—'}
                  </Td>
                </Tr>
                {txns.map((t, i) => {
                  const dr = parseFloat(String(t.debit)) || 0
                  const cr = parseFloat(String(t.credit)) || 0
                  return (
                    <Tr key={i}>
                      <Td className="text-sm" style={{ color: 'var(--ink-2)' }}>{formatDate(t.date)}</Td>
                      <Td>
                        <Link
                          to={`/journals?search=${encodeURIComponent(t.entry_no)}`}
                          className="mono text-xs hover:underline inline-flex items-center gap-1"
                          style={{ color: 'var(--brand)' }}
                        >
                          {t.entry_no}
                          <ExternalLink size={10} />
                        </Link>
                      </Td>
                      <Td className="text-xs" style={{ color: 'var(--ink-2)' }}>{t.voucher_type ?? '—'}</Td>
                      <Td className="text-xs mono" style={{ color: 'var(--ink-2)' }}
                        title="Pharmacy source document this entry was generated from">
                        {t.reference_type ? `${t.reference_type}${t.reference_id ? ` #${t.reference_id}` : ''}` : '—'}
                      </Td>
                      <Td className="text-sm truncate max-w-lg" style={{ color: 'var(--ink)' }}>{t.narration || '—'}</Td>
                      <Td className="text-right mono px-3" style={{ color: dr > 0 ? 'var(--ink)' : 'var(--ink-3)' }}>
                        {dr > 0 ? formatCurrency(dr) : '—'}
                      </Td>
                      <Td className="text-right mono px-3" style={{ color: cr > 0 ? 'var(--ink)' : 'var(--ink-3)' }}>
                        {cr > 0 ? formatCurrency(cr) : '—'}
                      </Td>
                      <Td className="text-right mono px-3" style={{ color: 'var(--ink)' }}>
                        {formatCurrency(t.balance)}
                      </Td>
                    </Tr>
                  )
                })}
                {txns.length === 0 && (
                  <Tr>
                    <Td colSpan={8} className="py-8 text-center text-sm" style={{ color: 'var(--ink-3)' }}>
                      No transactions in this period.
                    </Td>
                  </Tr>
                )}
              </Tbody>
            </Table>
            </div>
          </Card>

          {total > 0 && (
            <Pagination
              page={page}
              pageSize={pageSize}
              total={total}
              onPageChange={(p) => load(p)}
              onPageSizeChange={(s) => load(1, s)}
              pageSizeOptions={[50, 100, 200]}
            />
          )}
        </>
      )}
    </div>
  )
}

function Stat({ label, value, tone, mono }: {
  label: string
  value: string
  tone?: 'muted' | 'default'
  mono?: boolean
}) {
  const color = tone === 'muted' ? 'var(--ink-3)' : 'var(--ink)'
  return (
    <Card className="p-3">
      <div className="text-[10px] mono uppercase tracking-wider" style={{ color: 'var(--ink-3)' }}>
        {label}
      </div>
      <div className={`text-sm font-semibold mt-0.5 truncate ${mono ? 'font-mono' : 'font-mono'}`} style={{ color }}>
        {value}
      </div>
    </Card>
  )
}
