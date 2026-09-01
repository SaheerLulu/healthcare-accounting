import { useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Loader2, ChevronDown, ChevronRight } from 'lucide-react'
import { toast } from 'sonner'
import { getCashBook, type BookAccount } from '../../lib/api'
import { formatCurrency, formatDate, getCurrentFY, cn } from '../../lib/utils'
import { Input } from '../../components/ui/input'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { Table, Thead, Tbody, Tr, Th, Td } from '../../components/ui/table'
import { usePageKeyboard } from '../../hooks/usePageKeyboard'
import { useListKeyboardNav } from '../../hooks/useListKeyboardNav'

/**
 * One cash account: a header that expands its register.
 *
 * Its own component because the transaction cursor is a hook, and a hook
 * cannot be called inside the accounts loop. Each expanded account therefore
 * owns a roving tabindex over its own rows — Tbody is the container, so the
 * `data-kbd-row` lookups of two accounts never see each other.
 */
function CashAccount({
  acc,
  expanded,
  onToggle,
  onHeaderKeyDown,
}: {
  acc: BookAccount
  expanded: boolean
  onToggle: () => void
  onHeaderKeyDown: (e: React.KeyboardEvent<HTMLButtonElement>) => void
}) {
  const navigate = useNavigate()
  const txns = acc.transactions
  const panelId = `cash-book-${acc.account_code}`

  // A register row drills into the voucher behind it. Without this the entry
  // number was inert text styled like a link: one roving tab stop for the
  // whole register, ↑↓/Home/End/PgUp/PgDn to walk it, Enter to open.
  const rows = useListKeyboardNav({
    count: txns.length,
    onActivate: (i) => openEntry(txns[i].entry_no),
  })

  function openEntry(entryNo: string) {
    navigate(`/journals?search=${encodeURIComponent(entryNo)}`)
  }

  return (
    <Card className="overflow-hidden mb-4">
      <button
        type="button"
        data-account-header
        aria-expanded={expanded}
        // Only reference the panel while it exists in the DOM.
        aria-controls={expanded ? panelId : undefined}
        onClick={onToggle}
        onKeyDown={onHeaderKeyDown}
        className="w-full text-left flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-3 bg-slate-50 cursor-pointer hover:bg-slate-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--brand)]"
      >
        <div className="flex items-center gap-2 min-w-0">
          {expanded ? <ChevronDown size={16} className="flex-shrink-0" /> : <ChevronRight size={16} className="flex-shrink-0" />}
          <span className="font-mono text-xs text-slate-500 flex-shrink-0">{acc.account_code}</span>
          <span className="font-semibold text-sm text-slate-900 truncate">{acc.account_name}</span>
        </div>
        <span className={cn("font-mono text-sm font-medium whitespace-nowrap", Number(acc.closing_balance) >= 0 ? 'text-slate-900' : 'text-red-600')}>
          Closing: {formatCurrency(acc.closing_balance)}
        </span>
      </button>

      {expanded && (
        <Table id={panelId} label={`${acc.account_name} transactions`}>
          <Thead>
            <Tr>
              <Th>Date</Th>
              <Th>Entry No</Th>
              <Th>Narration</Th>
              <Th>Type</Th>
              <Th className="text-right">Debit</Th>
              <Th className="text-right">Credit</Th>
              <Th className="text-right">Balance</Th>
            </Tr>
          </Thead>
          <Tbody {...rows.containerProps}>
            <Tr className="bg-amber-50/50">
              <Td colSpan={4} className="text-sm font-medium text-slate-600">Opening Balance</Td>
              <Td />
              <Td />
              <Td className="text-right font-mono text-sm font-medium">{formatCurrency(acc.opening_balance)}</Td>
            </Tr>
            {txns.map((txn, i) => (
              <Tr key={i} {...rows.rowProps(i)}>
                <Td className="text-sm text-slate-500">{formatDate(txn.date)}</Td>
                <Td className="text-sm">
                  <Link
                    to={`/journals?search=${encodeURIComponent(txn.entry_no)}`}
                    // The row itself answers Enter; the link stays out of the
                    // tab order so a long register is not one stop per row.
                    tabIndex={-1}
                    className="font-mono text-teal-600 hover:underline"
                  >
                    {txn.entry_no}
                  </Link>
                </Td>
                <Td className="text-sm text-slate-900 max-w-xs truncate">{txn.narration}</Td>
                <Td className="text-sm text-slate-500 capitalize">{txn.voucher_type.replace(/_/g, ' ').toLowerCase()}</Td>
                <Td className="text-right font-mono text-sm">{Number(txn.debit) > 0 ? formatCurrency(txn.debit) : '-'}</Td>
                <Td className="text-right font-mono text-sm">{Number(txn.credit) > 0 ? formatCurrency(txn.credit) : '-'}</Td>
                <Td className={cn("text-right font-mono text-sm font-medium", Number(txn.balance) >= 0 ? '' : 'text-red-600')}>
                  {formatCurrency(txn.balance)}
                </Td>
              </Tr>
            ))}
            <Tr className="bg-slate-50 font-semibold border-t-2 border-slate-200">
              <Td colSpan={4} className="text-sm text-slate-600">Closing Balance</Td>
              <Td />
              <Td />
              <Td className={cn("text-right font-mono text-sm font-semibold", Number(acc.closing_balance) >= 0 ? '' : 'text-red-600')}>
                {formatCurrency(acc.closing_balance)}
              </Td>
            </Tr>
          </Tbody>
        </Table>
      )}
    </Card>
  )
}

export default function CashBookPage() {
  const navigate = useNavigate()
  const fy = getCurrentFY()
  const [accounts, setAccounts] = useState<BookAccount[]>([])
  const [summary, setSummary] = useState({ total_debit: '0.00', total_credit: '0.00' })
  const [loading, setLoading] = useState(false)
  const [fetched, setFetched] = useState(false)
  const [dateFrom, setDateFrom] = useState(fy.start)
  const [dateTo, setDateTo] = useState(fy.end)
  const [expandedAccounts, setExpandedAccounts] = useState<Set<string>>(new Set())
  const fromRef = useRef<HTMLInputElement>(null)
  const accountsRef = useRef<HTMLDivElement>(null)

  async function load() {
    setLoading(true)
    try {
      const res = await getCashBook({ start_date: dateFrom, end_date: dateTo })
      setAccounts(res.accounts)
      setSummary(res.summary)
      setFetched(true)
      if (res.accounts.length === 1) {
        setExpandedAccounts(new Set([res.accounts[0].account_code]))
      }
    } catch {
      toast.error('Failed to load cash book')
    } finally {
      setLoading(false)
    }
  }

  function toggleAccount(code: string) {
    setExpandedAccounts((prev) => {
      const next = new Set(prev)
      if (next.has(code)) next.delete(code)
      else next.add(code)
      return next
    })
  }

  // ─── Keyboard ──────────────────────────────────────────────────────────────
  // The account headers are real buttons, so Tab reaches them and Enter/Space
  // toggle them. ↑↓/Home/End move between headers the way an accordion should;
  // they are handled here rather than through useListKeyboardNav because that
  // hook finds its rows by `data-kbd-row`, and the headers' only common
  // ancestor also contains every expanded account's transaction rows — which
  // carry the same attribute for their own cursor.
  const headerButtons = () =>
    Array.from(accountsRef.current?.querySelectorAll<HTMLButtonElement>('[data-account-header]') ?? [])

  function onHeaderKeyDown(e: React.KeyboardEvent<HTMLButtonElement>) {
    const all = headerButtons()
    const i = all.indexOf(e.currentTarget)
    if (i === -1) return
    let next = -1
    if (e.key === 'ArrowDown') next = Math.min(all.length - 1, i + 1)
    else if (e.key === 'ArrowUp') next = Math.max(0, i - 1)
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = all.length - 1
    else return
    e.preventDefault()
    all[next]?.focus()
  }

  const focusAccounts = () => headerButtons()[0]?.focus()

  usePageKeyboard({
    actions: [
      { chord: 'Alt+R', label: 'Run report', run: load, when: !loading },
    ],
    searchRef: fromRef,
    onFocusList: focusAccounts,
    onBack: () => navigate(-1),
  })

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      <div className="mb-6">
        <h1 className="text-lg sm:text-xl font-semibold" style={{ color: "var(--ink)", letterSpacing: "-0.01em" }}>Cash Book</h1>
        <p className="text-sm mt-0.5" style={{ color: "var(--ink-2)" }}>All transactions through cash accounts</p>
      </div>

      {/* Period filters — a form, so Enter in either date runs the report */}
      <form
        className="flex items-center gap-2 sm:gap-3 mb-5 flex-wrap"
        onSubmit={(e) => { e.preventDefault(); load() }}
      >
        <div className="flex items-center gap-2 w-full sm:w-auto sm:flex-none">
          <label className="text-xs text-slate-500 font-medium">From</label>
          <Input ref={fromRef} data-autofocus type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-full sm:w-auto px-2.5 py-1.5" />
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto sm:flex-none">
          <label className="text-xs text-slate-500 font-medium">To</label>
          <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-full sm:w-auto px-2.5 py-1.5" />
        </div>
        <Button type="submit" disabled={loading} className="w-full sm:w-auto" chord="Alt+R">
          {loading && <Loader2 size={14} className="animate-spin" />}
          Run Report
        </Button>
      </form>

      {fetched && accounts.length === 0 && (
        <Card className="p-8 text-center text-slate-400 text-sm">No cash accounts found</Card>
      )}

      <div ref={accountsRef} className="space-y-5">
        {accounts.map((acc) => (
          <CashAccount
            key={acc.account_code}
            acc={acc}
            expanded={expandedAccounts.has(acc.account_code)}
            onToggle={() => toggleAccount(acc.account_code)}
            onHeaderKeyDown={onHeaderKeyDown}
          />
        ))}
      </div>

      {fetched && accounts.length > 0 && (
        <div className="flex flex-wrap justify-end gap-x-6 gap-y-1 mt-2 text-sm text-slate-600">
          <span>Total Debits: <span className="font-mono font-semibold">{formatCurrency(summary.total_debit)}</span></span>
          <span>Total Credits: <span className="font-mono font-semibold">{formatCurrency(summary.total_credit)}</span></span>
        </div>
      )}
    </div>
  )
}
