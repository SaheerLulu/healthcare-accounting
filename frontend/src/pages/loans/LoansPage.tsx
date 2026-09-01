import { useEffect, useMemo, useState } from 'react'
import { Plus, Eye, CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  listLoans, createLoan, getLoanSchedule, disburseLoan, payEMI, getChartOfAccounts,
  type Loan, type EMIRow, type Account,
  apiErrorMessage,
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
import { AccountPicker } from '../journals/AccountPicker'
import { usePageKeyboard } from '../../hooks/usePageKeyboard'
import { useListKeyboardNav } from '../../hooks/useListKeyboardNav'

function DialogFooter({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap gap-2 justify-end mt-4">{children}</div>
}

/**
 * A row's own button owns Enter and Space. Without this the keypress also
 * bubbles to the roving-tabindex row handler, which would run the row action a
 * second time — posting the same JE twice.
 */
const stopRowActivation = (e: React.KeyboardEvent) => {
  if (e.key === 'Enter' || e.key === ' ') e.stopPropagation()
}

/**
 * Escape inside an AccountPicker dropdown must close only the dropdown.
 * The picker closes itself but does not stop the event, and Radix dismisses the
 * dialog from a document-level listener — so one Escape tore down the whole
 * form and everything typed into it. The picker renders through a portal, so
 * the surviving signal is the event target's own ancestry (it stays intact even
 * once the portal has been detached).
 */
function keepDialogOpenForPicker(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null
  if (t && typeof t.closest === 'function' && t.closest('.dropdown-animate')) {
    e.preventDefault()
  }
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
    } catch (e) { toast.error(apiErrorMessage(e, 'Failed to load loans')) }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  async function disburse(l: Loan) {
    try {
      await disburseLoan(l.id)
      toast.success('Disbursement posted')
      await load()
      // The focused "Disburse" button unmounts once the loan has one; keep the
      // cursor on its row so the register can be worked down the list.
      window.setTimeout(() => list.focusList(), 0)
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Could not record the EMI payment.'))
    }
  }

  // Enter on a row opens its EMI schedule — the one action every loan has.
  const list = useListKeyboardNav({
    count: loans.length,
    onActivate: (i) => { const l = loans[i]; if (l) setScheduleFor(l) },
  })

  usePageKeyboard({
    actions: [
      { chord: 'Alt+N', label: 'New loan', run: () => setShowLoanDialog(true) },
      { chord: 'Alt+R', label: 'Refresh', run: load },
    ],
    onFocusList: list.focusList,
  })

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-lg sm:text-xl font-semibold" style={{ color: 'var(--ink)', letterSpacing: '-0.01em' }}>Loans & EMI</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--ink-2)' }}>
            <span className="mono">{loans.length}</span> loans
          </p>
        </div>
        <Button title="New loan (Alt+N)" onClick={() => setShowLoanDialog(true)}><Plus size={16} /> New Loan</Button>
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
            <Tbody {...list.containerProps}>
              {loans.map((l, i) => (
                <Tr key={l.id}
                  aria-label={`Loan ${l.loan_no} from ${l.lender_name} — Enter for the EMI schedule`}
                  className="cursor-pointer"
                  // role="button" without a click handler is a lie to the
                  // pointer AND to assistive tech, which activates a button by
                  // dispatching a click, not a keydown. Same target as Enter
                  // and as the row's own Schedule button: a read-only dialog.
                  onClick={() => setScheduleFor(l)}
                  {...list.rowProps(i)}>
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
                      <Button size="sm" variant="ghost"
                        aria-label={`Post disbursement for loan ${l.loan_no}`}
                        onKeyDown={stopRowActivation}
                        // Without this the click bubbles to the row and opens
                        // the schedule on top of the disbursement.
                        onClick={(e) => { e.stopPropagation(); disburse(l) }}>Disburse</Button>
                    )}
                    <Button size="sm" variant="ghost"
                      aria-label={`EMI schedule for loan ${l.loan_no}`}
                      onKeyDown={stopRowActivation}
                      onClick={(e) => { e.stopPropagation(); setScheduleFor(l) }}><Eye size={14} /> Schedule</Button>
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
  const [accounts, setAccounts] = useState<Account[]>([])
  const [data, setData] = useState({
    loan_no: '', lender_name: '', loan_type: 'term',
    principal_amount: '', interest_rate_pct: '',
    tenure_months: 36,
    start_date: new Date().toISOString().slice(0, 10),
    emi_day: 5,
    liability_account: null as number | null,
    interest_expense_account: null as number | null,
  })

  useEffect(() => {
    if (open) getChartOfAccounts().then(setAccounts).catch(() => {/* pickers degrade */})
  }, [open])

  // The two GLs used to be free-text "account ID" boxes. Everyone typed the
  // account code they know (2011) rather than its database id, and the server
  // answered 'Invalid pk "2011"' -- which the page then showed as "Failed".
  const liabilityAccounts = useMemo(
    () => accounts.filter((a) => a.account_type === 'LIABILITY'), [accounts])
  const expenseAccounts = useMemo(
    () => accounts.filter((a) => a.account_type === 'EXPENSE'), [accounts])
  async function save() {
    if (!data.liability_account || !data.interest_expense_account) {
      toast.error('Pick both the loan-liability and interest-expense GL accounts.')
      return
    }
    try {
      await createLoan({
        ...data,
        loan_type: data.loan_type as any,
        location_id: (activeLocationId ?? null) as any,
      } as any)
      toast.success('Loan created with amortization schedule')
      onSaved(); onClose()
    } catch (e: any) { toast.error(apiErrorMessage(e, 'Could not save the loan.')) }
  }

  return (
    <Dialog open={open} onOpenChange={(o: boolean) => !o && onClose()}>
      <DialogContent onEscapeKeyDown={keepDialogOpenForPicker}>
        <DialogHeader><DialogTitle>New Loan</DialogTitle></DialogHeader>
        {/* A real <form>: Enter in any field saves, instead of Tabbing past
            eight inputs, a select and two ledger pickers to reach Save. */}
        <form onSubmit={(e) => { e.preventDefault(); save() }}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input data-autofocus placeholder="Loan No." value={data.loan_no} onChange={(e) => setData({ ...data, loan_no: e.target.value })} />
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
          <Input type="number" min={1} max={28} placeholder="EMI day (1-28)" value={data.emi_day}
                 onChange={(e) => setData({ ...data, emi_day: parseInt(e.target.value || '5') })} />
          <label className="block text-xs font-medium text-slate-600">
            Loan-liability GL
            <AccountPicker accounts={liabilityAccounts} value={data.liability_account}
              onChange={(id) => setData({ ...data, liability_account: id })} />
          </label>
          <label className="block text-xs font-medium text-slate-600">
            Interest-expense GL
            <AccountPicker accounts={expenseAccounts} value={data.interest_expense_account}
              onChange={(id) => setData({ ...data, interest_expense_account: id })} />
          </label>
        </div>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit">Save</Button>
        </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ScheduleDialog({ loan, onClose, onPaid }: any) {
  const [emis, setEmis] = useState<EMIRow[]>([])
  const [loading, setLoading] = useState(false)
  // A 36-month loan is 36 rows, each with its own Pay button: without a rail,
  // reaching installment 30 meant Tabbing past 29 of them. Read-only nav (no
  // onActivate — paying is a JE, not a row action): ↑↓/PgUp/PgDn/Home/End walk
  // the schedule, then one Tab from the focused row lands on THAT row's Pay.
  const emiList = useListKeyboardNav({ count: emis.length })
  useEffect(() => {
    if (!loan) return
    setLoading(true)
    getLoanSchedule(loan.id)
      .then((r) => setEmis(r.rows))
      .catch((e) => toast.error(apiErrorMessage(e, 'Failed to load schedule')))
      .finally(() => setLoading(false))
  }, [loan])
  if (!loan) return null
  return (
    <Dialog open={!!loan} onOpenChange={(o: boolean) => !o && onClose()}>
      {/* The page's own F3 is suppressed behind an overlay (HotkeyContext skips
          handlers registered shallower than the current depth), so the dialog
          carries its own — otherwise the only way into the schedule is Tab. */}
      <DialogContent className="max-w-3xl"
        onKeyDown={(e) => {
          if (e.key !== 'F3') return
          e.preventDefault()
          emiList.focusList()
        }}>
        <DialogHeader><DialogTitle>EMI Schedule — {loan.loan_no}</DialogTitle></DialogHeader>
          {loading ? <SkeletonTable /> : (
            // The height cap belongs on <Table>'s own scroll rail: nesting it
            // in a second scroll container would leave the sticky header stuck
            // to the inner rail, which never scrolls vertically.
            <Table wrapperClassName="max-h-[60vh] overflow-y-auto">
              <Thead><Tr><Th>#</Th><Th>Due</Th><Th className="text-right">Principal</Th>
                <Th className="text-right">Interest</Th><Th className="text-right">Total</Th>
                <Th className="text-right">Balance</Th><Th>Status</Th><Th></Th></Tr></Thead>
              <Tbody {...emiList.containerProps}>
                {emis.map((e, i) => (
                  <Tr key={e.id}
                    aria-label={`Installment ${e.installment_no} due ${e.due_date} — ${e.status}`}
                    {...emiList.rowProps(i)}>
                    <Td className="mono">{e.installment_no}</Td>
                    <Td>{formatDate(e.due_date)}</Td>
                    <Td className="text-right mono">{formatCurrency(e.principal)}</Td>
                    <Td className="text-right mono">{formatCurrency(e.interest)}</Td>
                    <Td className="text-right mono font-medium">{formatCurrency(e.total_emi ?? '0')}</Td>
                    <Td className="text-right mono">{formatCurrency(e.balance_principal)}</Td>
                    <Td><Badge variant={e.status === 'paid' ? 'success' : 'default'}>{e.status}</Badge></Td>
                    <Td>
                      {e.status === 'pending' && (
                        <Button size="sm" variant="ghost"
                          aria-label={`Pay EMI ${e.installment_no} due ${e.due_date}`}
                          onClick={async () => {
                          try {
                            await payEMI(e.id)
                            toast.success(`EMI ${e.installment_no} paid`)
                            const r = await getLoanSchedule(loan.id)
                            setEmis(r.rows); onPaid()
                          } catch (e) { toast.error(apiErrorMessage(e, 'Could not record the EMI payment.')) }
                        }}><CheckCircle2 size={14} /> Pay</Button>
                      )}
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          )}
        {/* Read-only dialog: land on Close, not on the header's X, so Enter and
            Escape agree about what the obvious key does here. */}
        <DialogFooter><Button data-autofocus type="button" variant="secondary" onClick={onClose}>Close</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
