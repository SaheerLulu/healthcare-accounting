import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, ChevronDown, ChevronRight } from 'lucide-react'
import { toast } from 'sonner'
import { getBankBook, type BookAccount } from '../../lib/api'
import { formatCurrency, formatDate, getCurrentFY, cn } from '../../lib/utils'
import { Input } from '../../components/ui/input'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { Table, Thead, Tbody, Tr, Th, Td } from '../../components/ui/table'
import { usePageKeyboard } from '../../hooks/usePageKeyboard'
import { useListKeyboardNav } from '../../hooks/useListKeyboardNav'

export default function BankBookPage() {
  const navigate = useNavigate()
  const fy = getCurrentFY()
  const [accounts, setAccounts] = useState<BookAccount[]>([])
  const [summary, setSummary] = useState({ total_debit: '0.00', total_credit: '0.00' })
  const [loading, setLoading] = useState(false)
  const [fetched, setFetched] = useState(false)
  const [dateFrom, setDateFrom] = useState(fy.start)
  const [dateTo, setDateTo] = useState(fy.end)
  const [expandedAccounts, setExpandedAccounts] = useState<Set<string>>(new Set())
  const dateFromRef = useRef<HTMLInputElement>(null)

  async function load() {
    setLoading(true)
    try {
      const res = await getBankBook({ start_date: dateFrom, end_date: dateTo })
      setAccounts(res.accounts)
      setSummary(res.summary)
      setFetched(true)
      if (res.accounts.length === 1) {
        setExpandedAccounts(new Set([res.accounts[0].account_code]))
      }
    } catch {
      toast.error('Failed to load bank book')
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
  // Each account header is a click-to-expand strip, which on its own is
  // pointer-only: a <div onClick> is not focusable and answers no key. The
  // roving tabindex makes the whole stack one tab stop — ↑↓ walk the accounts,
  // Enter/Space expands the one under the cursor.
  const list = useListKeyboardNav({
    count: accounts.length,
    onActivate: (i) => toggleAccount(accounts[i].account_code),
  })

  usePageKeyboard({
    actions: [
      { chord: 'Alt+R', label: 'Run report', run: load, when: !loading },
    ],
    searchRef: dateFromRef,
    onFocusList: list.focusList,
    onBack: () => navigate(-1),
  })

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      <div className="mb-6">
        <h1 className="text-lg sm:text-xl font-semibold" style={{ color: "var(--ink)", letterSpacing: "-0.01em" }}>Bank Book</h1>
        <p className="text-sm mt-0.5" style={{ color: "var(--ink-2)" }}>All transactions through bank accounts</p>
      </div>

      {/* A form, so Enter from either date field runs the report — the button
          was previously the only way to fire it. */}
      <form
        className="flex items-center gap-2 sm:gap-3 mb-5 flex-wrap"
        onSubmit={(e) => { e.preventDefault(); load() }}
      >
        <div className="flex items-center gap-2 w-full sm:w-auto sm:flex-none">
          <label className="text-xs text-slate-500 font-medium" htmlFor="bankbook-from">From</label>
          <Input id="bankbook-from" ref={dateFromRef} data-autofocus type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-full sm:w-auto px-2.5 py-1.5" />
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto sm:flex-none">
          <label className="text-xs text-slate-500 font-medium" htmlFor="bankbook-to">To</label>
          <Input id="bankbook-to" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-full sm:w-auto px-2.5 py-1.5" />
        </div>
        <Button type="submit" chord="Alt+R" disabled={loading} className="w-full sm:w-auto">
          {loading && <Loader2 size={14} className="animate-spin" />}
          Run Report
        </Button>
      </form>

      {/* The result set swaps under a user whose focus never moves, so say what
          arrived. */}
      <div className="sr-only" role="status" aria-live="polite">
        {loading
          ? 'Loading bank book…'
          : fetched
            ? `${accounts.length} bank ${accounts.length === 1 ? 'account' : 'accounts'} from ${dateFrom} to ${dateTo}`
            : ''}
      </div>

      {fetched && accounts.length === 0 && (
        <Card className="p-8 text-center text-slate-400 text-sm">No bank accounts found</Card>
      )}

      <div {...list.containerProps}>
        {accounts.map((acc, i) => {
          const expanded = expandedAccounts.has(acc.account_code)
          return (
            <Card key={acc.account_code} className="overflow-hidden mb-4">
              <div
                className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-3 bg-slate-50 cursor-pointer hover:bg-slate-100 transition-colors"
                onClick={() => toggleAccount(acc.account_code)}
                aria-expanded={expanded}
                aria-label={`${acc.account_code} ${acc.account_name}, closing ${formatCurrency(acc.closing_balance)}`}
                {...list.rowProps(i)}
              >
                <div className="flex items-center gap-2 min-w-0">
                  {expanded ? <ChevronDown size={16} className="flex-shrink-0" /> : <ChevronRight size={16} className="flex-shrink-0" />}
                  <span className="font-mono text-xs text-slate-500 flex-shrink-0">{acc.account_code}</span>
                  <span className="font-semibold text-sm text-slate-900 truncate">{acc.account_name}</span>
                </div>
                <span className={cn("font-mono text-sm font-medium whitespace-nowrap", Number(acc.closing_balance) >= 0 ? 'text-slate-900' : 'text-red-600')}>
                  Closing: {formatCurrency(acc.closing_balance)}
                </span>
              </div>

              {expanded && (
                <Table label={`${acc.account_name} transactions`}>
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
                  <Tbody>
                    <Tr className="bg-amber-50/50">
                      <Td colSpan={4} className="text-sm font-medium text-slate-600">Opening Balance</Td>
                      <Td />
                      <Td />
                      <Td className="text-right font-mono text-sm font-medium">{formatCurrency(acc.opening_balance)}</Td>
                    </Tr>
                    {acc.transactions.map((txn, ti) => (
                      <Tr key={ti}>
                        <Td className="text-sm text-slate-500">{formatDate(txn.date)}</Td>
                        <Td className="text-sm font-mono text-teal-600">{txn.entry_no}</Td>
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
        })}
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
