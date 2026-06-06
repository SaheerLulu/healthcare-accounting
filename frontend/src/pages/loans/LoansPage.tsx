import { useEffect, useState } from 'react'
import { Plus, Eye, CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  listLoans, createLoan, getLoanSchedule, disburseLoan, payEMI,
  type Loan, type EMIRow,
} from '../../lib/api'
import { useLocation } from '../../contexts/LocationContext'
import { formatCurrency, formatDate } from '../../lib/utils'
import { Button } from '../../components/ui/button'
import { Badge } from '../../components/ui/badge'
import { Input } from '../../components/ui/input'
import { Card } from '../../components/ui/card'
import { Table, Thead, Tbody, Tr, Th, Td } from '../../components/ui/table'
import { EmptyState } from '../../components/ui/EmptyState'
import { SkeletonTable } from '../../components/ui/Skeletons'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../components/ui/dialog'

function DialogFooter({ children }: { children: React.ReactNode }) {
  return <div className="flex gap-2 justify-end mt-4">{children}</div>
}

export default function LoansPage() {
  const [loans, setLoans] = useState<Loan[]>([])
  const [loading, setLoading] = useState(true)
  const [showLoanDialog, setShowLoanDialog] = useState(false)
  const [scheduleFor, setScheduleFor] = useState<Loan | null>(null)

  async function load() {
    setLoading(true)
    try {
      const r = await listLoans()
      setLoans(Array.isArray(r) ? r : (r.results ?? []))
    } catch { toast.error('Failed to load loans') }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--ink)', letterSpacing: '-0.01em' }}>Loans & EMI</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--ink-2)' }}>
            <span className="mono">{loans.length}</span> loans
          </p>
        </div>
        <Button onClick={() => setShowLoanDialog(true)}><Plus size={16} /> New Loan</Button>
      </div>

      {loading ? <SkeletonTable /> : loans.length === 0 ? (
        <EmptyState title="No loans" description="Capture your first term loan or working-capital facility to start tracking EMIs." />
      ) : (
        <Card>
          <Table>
            <Thead>
              <Tr><Th>Loan No.</Th><Th>Lender</Th><Th>Type</Th>
                <Th className="text-right">Principal</Th><Th className="text-right">Outstanding</Th>
                <Th className="text-right">EMI</Th><Th>Tenure</Th><Th>Status</Th><Th></Th></Tr>
            </Thead>
            <Tbody>
              {loans.map((l) => (
                <Tr key={l.id}>
                  <Td className="mono">{l.loan_no}</Td>
                  <Td>{l.lender_name}</Td>
                  <Td>{l.loan_type}</Td>
                  <Td className="text-right mono">{formatCurrency(l.principal_amount)}</Td>
                  <Td className="text-right mono">{formatCurrency(l.outstanding_principal ?? l.principal_amount)}</Td>
                  <Td className="text-right mono">{formatCurrency(l.emi_amount)}</Td>
                  <Td>{l.tenure_months}m @ {l.interest_rate_pct}%</Td>
                  <Td><Badge variant={l.status === 'active' ? 'success' : 'default'}>{l.status}</Badge></Td>
                  <Td className="flex gap-1">
                    {!l.disbursement_entry_no && (
                      <Button size="sm" variant="ghost" onClick={async () => {
                        try { await disburseLoan(l.id); toast.success('Disbursement posted'); load() }
                        catch { toast.error('Failed') }
                      }}>Disburse</Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => setScheduleFor(l)}><Eye size={14} /> Schedule</Button>
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </Card>
      )}

      <NewLoanDialog open={showLoanDialog} onClose={() => setShowLoanDialog(false)} onSaved={load} />
      <ScheduleDialog loan={scheduleFor} onClose={() => setScheduleFor(null)} onPaid={load} />
    </div>
  )
}

function NewLoanDialog({ open, onClose, onSaved }: any) {
  const { activeLocationId } = useLocation()
  const [data, setData] = useState({
    loan_no: '', lender_name: '', loan_type: 'term',
    principal_amount: '', interest_rate_pct: '',
    tenure_months: 36,
    start_date: new Date().toISOString().slice(0, 10),
    emi_day: 5,
    liability_account: '', interest_expense_account: '',
  })
  return (
    <Dialog open={open} onOpenChange={(o: boolean) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>New Loan</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <Input placeholder="Loan No." value={data.loan_no} onChange={(e) => setData({ ...data, loan_no: e.target.value })} />
          <Input placeholder="Lender name" value={data.lender_name} onChange={(e) => setData({ ...data, lender_name: e.target.value })} />
          <select className="border rounded px-2 py-1.5" value={data.loan_type}
                  onChange={(e) => setData({ ...data, loan_type: e.target.value })}>
            <option value="term">Term</option>
            <option value="working_capital">Working Capital</option>
            <option value="overdraft">Overdraft</option>
            <option value="vehicle">Vehicle</option>
            <option value="mortgage">Mortgage</option>
          </select>
          <Input type="date" value={data.start_date}
                 onChange={(e) => setData({ ...data, start_date: e.target.value })} />
          <Input placeholder="Principal ₹" value={data.principal_amount}
                 onChange={(e) => setData({ ...data, principal_amount: e.target.value })} />
          <Input placeholder="Interest rate %" value={data.interest_rate_pct}
                 onChange={(e) => setData({ ...data, interest_rate_pct: e.target.value })} />
          <Input type="number" placeholder="Tenure (months)" value={data.tenure_months}
                 onChange={(e) => setData({ ...data, tenure_months: parseInt(e.target.value || '0') })} />
          <Input type="number" placeholder="EMI day (1-28)" value={data.emi_day}
                 onChange={(e) => setData({ ...data, emi_day: parseInt(e.target.value || '5') })} />
          <Input placeholder="Loan-liability GL account ID" value={data.liability_account}
                 onChange={(e) => setData({ ...data, liability_account: e.target.value })} />
          <Input placeholder="Interest-expense GL account ID" value={data.interest_expense_account}
                 onChange={(e) => setData({ ...data, interest_expense_account: e.target.value })} />
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={async () => {
            try {
              await createLoan({
                ...data,
                loan_type: data.loan_type as any,
                liability_account: parseInt(data.liability_account) as any,
                interest_expense_account: parseInt(data.interest_expense_account) as any,
                location_id: (activeLocationId ?? null) as any,
              } as any)
              toast.success('Loan created with amortization schedule')
              onSaved(); onClose()
            } catch (e: any) { toast.error(e?.response?.data?.detail || 'Failed') }
          }}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ScheduleDialog({ loan, onClose, onPaid }: any) {
  const [emis, setEmis] = useState<EMIRow[]>([])
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    if (!loan) return
    setLoading(true)
    getLoanSchedule(loan.id)
      .then((r) => setEmis(r.rows))
      .catch(() => toast.error('Failed to load schedule'))
      .finally(() => setLoading(false))
  }, [loan])
  if (!loan) return null
  return (
    <Dialog open={!!loan} onOpenChange={(o: boolean) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader><DialogTitle>EMI Schedule — {loan.loan_no}</DialogTitle></DialogHeader>
        <div className="max-h-[60vh] overflow-auto">
          {loading ? <SkeletonTable /> : (
            <Table>
              <Thead><Tr><Th>#</Th><Th>Due</Th><Th className="text-right">Principal</Th>
                <Th className="text-right">Interest</Th><Th className="text-right">Total</Th>
                <Th className="text-right">Balance</Th><Th>Status</Th><Th></Th></Tr></Thead>
              <Tbody>
                {emis.map((e) => (
                  <Tr key={e.id}>
                    <Td className="mono">{e.installment_no}</Td>
                    <Td>{formatDate(e.due_date)}</Td>
                    <Td className="text-right mono">{formatCurrency(e.principal)}</Td>
                    <Td className="text-right mono">{formatCurrency(e.interest)}</Td>
                    <Td className="text-right mono font-medium">{formatCurrency(e.total_emi ?? '0')}</Td>
                    <Td className="text-right mono">{formatCurrency(e.balance_principal)}</Td>
                    <Td><Badge variant={e.status === 'paid' ? 'success' : 'default'}>{e.status}</Badge></Td>
                    <Td>
                      {e.status === 'pending' && (
                        <Button size="sm" variant="ghost" onClick={async () => {
                          try {
                            await payEMI(e.id)
                            toast.success(`EMI ${e.installment_no} paid`)
                            const r = await getLoanSchedule(loan.id)
                            setEmis(r.rows); onPaid()
                          } catch { toast.error('Failed') }
                        }}><CheckCircle2 size={14} /> Pay</Button>
                      )}
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          )}
        </div>
        <DialogFooter><Button variant="secondary" onClick={onClose}>Close</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
