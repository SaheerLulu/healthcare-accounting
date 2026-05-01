import { useState } from 'react'
import { Loader2, ChevronDown, ChevronRight } from 'lucide-react'
import { toast } from 'sonner'
import { getCashBook, type BookAccount } from '../../lib/api'
import { formatCurrency, formatDate, getCurrentFY, cn } from '../../lib/utils'
import { Input } from '../../components/ui/input'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { Table, Thead, Tbody, Tr, Th, Td } from '../../components/ui/table'

export default function CashBookPage() {
  const fy = getCurrentFY()
  const [accounts, setAccounts] = useState<BookAccount[]>([])
  const [summary, setSummary] = useState({ total_debit: '0.00', total_credit: '0.00' })
  const [loading, setLoading] = useState(false)
  const [fetched, setFetched] = useState(false)
  const [dateFrom, setDateFrom] = useState(fy.start)
  const [dateTo, setDateTo] = useState(fy.end)
  const [expandedAccounts, setExpandedAccounts] = useState<Set<string>>(new Set())

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

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      <div className="mb-6">
        <h1 className="text-xl font-semibold" style={{ color: "var(--ink)", letterSpacing: "-0.01em" }}>Cash Book</h1>
        <p className="text-sm mt-0.5" style={{ color: "var(--ink-2)" }}>All transactions through cash accounts</p>
      </div>

      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-500 font-medium">From</label>
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-auto px-2.5 py-1.5" />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-500 font-medium">To</label>
          <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-auto px-2.5 py-1.5" />
        </div>
        <Button onClick={load} disabled={loading}>
          {loading && <Loader2 size={14} className="animate-spin" />}
          Run Report
        </Button>
      </div>

      {fetched && accounts.length === 0 && (
        <Card className="p-8 text-center text-slate-400 text-sm">No cash accounts found</Card>
      )}

      {accounts.map((acc) => (
        <Card key={acc.account_code} className="overflow-hidden mb-4">
          <div
            className="flex items-center justify-between px-4 py-3 bg-slate-50 cursor-pointer hover:bg-slate-100 transition-colors"
            onClick={() => toggleAccount(acc.account_code)}
          >
            <div className="flex items-center gap-2">
              {expandedAccounts.has(acc.account_code) ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              <span className="font-mono text-xs text-slate-500">{acc.account_code}</span>
              <span className="font-semibold text-sm text-slate-900">{acc.account_name}</span>
            </div>
            <span className={cn("font-mono text-sm font-medium", Number(acc.closing_balance) >= 0 ? 'text-slate-900' : 'text-red-600')}>
              Closing: {formatCurrency(acc.closing_balance)}
            </span>
          </div>

          {expandedAccounts.has(acc.account_code) && (
            <Table>
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
                {acc.transactions.map((txn, i) => (
                  <Tr key={i}>
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
      ))}

      {fetched && accounts.length > 0 && (
        <div className="flex justify-end gap-6 mt-2 text-sm text-slate-600">
          <span>Total Debits: <span className="font-mono font-semibold">{formatCurrency(summary.total_debit)}</span></span>
          <span>Total Credits: <span className="font-mono font-semibold">{formatCurrency(summary.total_credit)}</span></span>
        </div>
      )}
    </div>
  )
}
