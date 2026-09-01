import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, Plus, Pencil, Trash2, Play, CreditCard } from 'lucide-react'
import { toast } from 'sonner'
import {
  getEmployees, createEmployee, updateEmployee, deleteEmployee,
  getSalaryStructures, createSalaryStructure, updateSalaryStructure,
  getPayrollRuns, processPayroll, markPayrollPaid,
  type Employee, type SalaryStructureData, type PayrollRunData,
} from '../lib/api'
import { formatCurrency, getCurrentPeriod } from '../lib/utils'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose } from '../components/ui/dialog'
import { Button } from '../components/ui/button'
import { Badge } from '../components/ui/badge'
import { Input } from '../components/ui/input'
import { Card } from '../components/ui/card'
import { Table, Thead, Tbody, Tr, Th, Td } from '../components/ui/table'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { usePageKeyboard } from '../hooks/usePageKeyboard'
import { useListKeyboardNav } from '../hooks/useListKeyboardNav'

// ─── Employees Tab ──────────────────────────────────────────────────────────

function EmployeesTab() {
  const navigate = useNavigate()
  const formRef = useRef<HTMLFormElement>(null)
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [form, setForm] = useState({
    employee_code: '', name: '', pan: '', bank_account_no: '', bank_ifsc: '',
    date_of_joining: new Date().toISOString().split('T')[0], is_active: true,
  })

  async function load() {
    setLoading(true)
    try { setEmployees(await getEmployees()) } catch { toast.error('Failed to load employees') }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  function openEdit(emp: Employee) {
    setEditId(emp.id)
    setForm({
      employee_code: emp.employee_code, name: emp.name, pan: emp.pan,
      bank_account_no: emp.bank_account_no, bank_ifsc: emp.bank_ifsc,
      date_of_joining: emp.date_of_joining, is_active: emp.is_active,
    })
    setDialogOpen(true)
  }

  function openNew() {
    setEditId(null)
    setForm({ employee_code: '', name: '', pan: '', bank_account_no: '', bank_ifsc: '',
      date_of_joining: new Date().toISOString().split('T')[0], is_active: true })
    setDialogOpen(true)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      if (editId) await updateEmployee(editId, form)
      else await createEmployee(form)
      toast.success(editId ? 'Employee updated' : 'Employee created')
      setDialogOpen(false)
      load()
    } catch { toast.error('Failed to save employee') }
    finally { setSaving(false) }
  }

  async function handleDelete(id: number) {
    if (!confirm('Delete this employee?')) return
    try { await deleteEmployee(id); toast.success('Employee deleted'); load() }
    catch { toast.error('Cannot delete employee with payroll runs') }
  }

  // Roving tabindex over the register: one tab stop for the whole table, ↑↓ to
  // walk it, Enter to edit the focused employee, and Tab from a row lands on
  // that row's own Edit/Delete rather than on row one's.
  const list = useListKeyboardNav({
    count: employees.length,
    onActivate: (i) => openEdit(employees[i]),
  })

  usePageKeyboard({
    actions: [
      { chord: 'Alt+N', label: 'Add employee', run: openNew },
      { chord: 'Alt+R', label: 'Refresh', run: load },
      {
        chord: 'Ctrl+S',
        label: 'Save',
        run: () => formRef.current?.requestSubmit(),
        when: dialogOpen,
      },
    ],
    onFocusList: list.focusList,
    onBack: () => navigate(-1),
  })

  return (
    <div>
      <div className="flex flex-wrap justify-between items-center gap-3 mb-4">
        <p className="text-sm text-slate-500">{employees.length} employees</p>
        <Button size="sm" onClick={openNew}><Plus size={14} /> Add Employee</Button>
      </div>

      <Card className="overflow-hidden">
        <Table>
          <Thead>
            <Tr className="bg-slate-50">
              <Th>Code</Th>
              <Th>Name</Th>
              <Th>PAN</Th>
              <Th>Joining Date</Th>
              <Th>Status</Th>
              <Th className="w-20" />
            </Tr>
          </Thead>
          <Tbody {...list.containerProps}>
            {loading ? (
              <tr><td colSpan={6} className="text-center py-12"><Loader2 size={24} className="animate-spin inline text-teal-600" /></td></tr>
            ) : employees.length === 0 ? (
              <tr><td colSpan={6} className="text-center py-12 text-slate-400 text-sm">No employees</td></tr>
            ) : employees.map((emp, i) => {
              const rowKb = list.rowProps(i)
              return (
              <Tr
                key={emp.id}
                className="group"
                aria-label={`${emp.employee_code} ${emp.name} — Enter to edit`}
                {...rowKb}
                // Keyboard only: Enter on the focused row edits, while a click
                // stays inert as it always was — Edit is the pointer's target.
                // Enter on the row's own Edit/Delete button belongs to that
                // button, so the list handler runs only while the ROW has focus.
                onKeyDown={(e) => { if (e.target === e.currentTarget) rowKb.onKeyDown(e) }}
              >
                <Td className="font-mono text-xs text-slate-500">{emp.employee_code}</Td>
                <Td className="font-medium">{emp.name}</Td>
                <Td className="text-sm text-slate-500">{emp.pan || '-'}</Td>
                <Td className="text-sm text-slate-500">{emp.date_of_joining}</Td>
                <Td><Badge variant={emp.is_active ? 'success' : 'warning'}>{emp.is_active ? 'Active' : 'Inactive'}</Badge></Td>
                <Td>
                  {/* group-focus-within as well as group-hover: an opacity-0
                      button is still focusable and still clickable, so Tab used
                      to land on an invisible control and Enter deleted an
                      employee the user could not see they had selected. */}
                  <div className="flex items-center gap-1 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 lg:group-focus-within:opacity-100 transition-opacity">
                    <button
                      type="button"
                      aria-label={`Edit ${emp.name}`}
                      onClick={() => openEdit(emp)}
                      className="p-1 min-h-9 min-w-9 sm:min-h-0 sm:min-w-0 rounded text-slate-400 hover:text-teal-600 focus-visible:text-teal-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-teal-500"
                    ><Pencil size={14} /></button>
                    <button
                      type="button"
                      aria-label={`Delete ${emp.name}`}
                      onClick={() => handleDelete(emp.id)}
                      className="p-1 min-h-9 min-w-9 sm:min-h-0 sm:min-w-0 rounded text-slate-400 hover:text-red-500 focus-visible:text-red-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-red-400"
                    ><Trash2 size={14} /></button>
                  </div>
                </Td>
              </Tr>
              )
            })}
          </Tbody>
        </Table>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editId ? 'Edit Employee' : 'Add Employee'}</DialogTitle></DialogHeader>
          <form ref={formRef} onSubmit={handleSave} className="flex flex-col gap-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1.5">Employee Code *</label>
                {/* DialogContent focuses [data-autofocus] on open, so the form
                    starts on its first field rather than the close X. */}
                <Input required data-autofocus value={form.employee_code} onChange={(e) => setForm({ ...form, employee_code: e.target.value })} />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1.5">Name *</label>
                <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1.5">PAN</label>
                <Input value={form.pan} onChange={(e) => setForm({ ...form, pan: e.target.value })} maxLength={10} />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1.5">Bank Account</label>
                <Input value={form.bank_account_no} onChange={(e) => setForm({ ...form, bank_account_no: e.target.value })} />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1.5">IFSC</label>
                <Input value={form.bank_ifsc} onChange={(e) => setForm({ ...form, bank_ifsc: e.target.value })} maxLength={11} />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1.5">Joining Date *</label>
                <Input type="date" required value={form.date_of_joining} onChange={(e) => setForm({ ...form, date_of_joining: e.target.value })} />
              </div>
              <div className="flex items-end min-h-9 sm:min-h-0">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                    className="accent-teal-600" /> Active
                </label>
              </div>
            </div>
            <div className="flex gap-3 justify-end pt-2">
              <DialogClose asChild><Button type="button" variant="secondary">Cancel</Button></DialogClose>
              <Button type="submit" disabled={saving}>{saving && <Loader2 size={14} className="animate-spin" />} Save</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ─── Salary Structures Tab ──────────────────────────────────────────────────

function SalaryStructuresTab() {
  const navigate = useNavigate()
  const formRef = useRef<HTMLFormElement>(null)
  const [structures, setStructures] = useState<SalaryStructureData[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [form, setForm] = useState({
    employee: '', basic_salary: '', hra: '', conveyance: '', medical: '', special_allowance: '',
    pf_employee_pct: '12.00', pf_employer_pct: '12.00', esi_employee_pct: '0', esi_employer_pct: '0',
    professional_tax: '0', effective_from: new Date().toISOString().split('T')[0], is_active: true,
  })

  async function load() {
    setLoading(true)
    try {
      const [s, e] = await Promise.all([getSalaryStructures(), getEmployees()])
      setStructures(s); setEmployees(e)
    } catch { toast.error('Failed to load') }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  function openNew() {
    setEditId(null)
    setForm({ employee: '', basic_salary: '', hra: '', conveyance: '', medical: '', special_allowance: '',
      pf_employee_pct: '12.00', pf_employer_pct: '12.00', esi_employee_pct: '0', esi_employer_pct: '0',
      professional_tax: '0', effective_from: new Date().toISOString().split('T')[0], is_active: true })
    setDialogOpen(true)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const numericFields = [
        'basic_salary', 'hra', 'conveyance', 'medical', 'special_allowance',
        'pf_employee_pct', 'pf_employer_pct', 'esi_employee_pct', 'esi_employer_pct',
        'professional_tax',
      ] as const
      const data: Record<string, unknown> = { ...form, employee: Number(form.employee) }
      for (const f of numericFields) {
        const v = (form as unknown as Record<string, string>)[f]
        data[f] = v === '' || v == null ? '0' : v
      }
      if (editId) await updateSalaryStructure(editId, data as unknown as Partial<SalaryStructureData>)
      else await createSalaryStructure(data as unknown as Partial<SalaryStructureData>)
      toast.success(editId ? 'Updated' : 'Created')
      setDialogOpen(false)
      load()
    } catch (err) {
      const e = err as { response?: { data?: Record<string, unknown> } }
      const data = e.response?.data
      const msg = data
        ? Object.entries(data)
            .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : String(v)}`)
            .join(' • ')
        : 'Failed to save'
      toast.error(msg)
    }
    finally { setSaving(false) }
  }

  const gross = ['basic_salary', 'hra', 'conveyance', 'medical', 'special_allowance']
    .reduce((s, k) => s + Number((form as unknown as Record<string, string>)[k] || 0), 0)

  // No row action exists for a structure, so the list navigates without an
  // Enter target — it is there to give a keyboard reader a "you are here" rail.
  const list = useListKeyboardNav({ count: structures.length })

  usePageKeyboard({
    actions: [
      { chord: 'Alt+N', label: 'Add structure', run: openNew },
      { chord: 'Alt+R', label: 'Refresh', run: load },
      {
        chord: 'Ctrl+S',
        label: 'Save',
        run: () => formRef.current?.requestSubmit(),
        when: dialogOpen,
      },
    ],
    onFocusList: list.focusList,
    onBack: () => navigate(-1),
  })

  return (
    <div>
      <div className="flex flex-wrap justify-between items-center gap-3 mb-4">
        <p className="text-sm text-slate-500">{structures.length} structures</p>
        <Button size="sm" onClick={openNew}><Plus size={14} /> Add Structure</Button>
      </div>

      <Card className="overflow-hidden">
        <Table>
          <Thead>
            <Tr className="bg-slate-50">
              <Th>Employee</Th>
              <Th className="text-right">Basic</Th>
              <Th className="text-right">HRA</Th>
              <Th className="text-right">Gross</Th>
              <Th className="text-right">PF %</Th>
              <Th className="text-right">PT</Th>
              <Th>From</Th>
              <Th>Status</Th>
            </Tr>
          </Thead>
          <Tbody {...list.containerProps}>
            {loading ? (
              <tr><td colSpan={8} className="text-center py-12"><Loader2 size={24} className="animate-spin inline text-teal-600" /></td></tr>
            ) : structures.length === 0 ? (
              <tr><td colSpan={8} className="text-center py-12 text-slate-400 text-sm">No salary structures</td></tr>
            ) : structures.map((s, i) => (
              <Tr key={s.id} aria-label={`Salary structure for ${s.employee_name}`} {...list.rowProps(i)}>
                <Td className="font-medium">{s.employee_name}</Td>
                <Td className="text-right font-mono text-sm">{formatCurrency(s.basic_salary)}</Td>
                <Td className="text-right font-mono text-sm">{formatCurrency(s.hra)}</Td>
                <Td className="text-right font-mono text-sm font-semibold">{formatCurrency(s.gross_salary)}</Td>
                <Td className="text-right text-sm text-slate-500">{s.pf_employee_pct}%</Td>
                <Td className="text-right font-mono text-sm">{formatCurrency(s.professional_tax)}</Td>
                <Td className="text-sm text-slate-500">{s.effective_from}</Td>
                <Td><Badge variant={s.is_active ? 'success' : 'warning'}>{s.is_active ? 'Active' : 'Inactive'}</Badge></Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editId ? 'Edit Structure' : 'Add Salary Structure'}</DialogTitle></DialogHeader>
          <form ref={formRef} onSubmit={handleSave} className="flex flex-col gap-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1.5">Employee *</label>
                <select required data-autofocus value={form.employee} onChange={(e) => setForm({ ...form, employee: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500">
                  <option value="">-- Select --</option>
                  {employees.map((emp) => <option key={emp.id} value={emp.id}>{emp.employee_code} - {emp.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1.5">Effective From *</label>
                <Input type="date" required value={form.effective_from} onChange={(e) => setForm({ ...form, effective_from: e.target.value })} />
              </div>
            </div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mt-2">Earnings</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {(['basic_salary', 'hra', 'conveyance', 'medical', 'special_allowance'] as const).map((f) => (
                <div key={f}>
                  <label className="block text-xs font-medium text-slate-500 mb-1">{f.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</label>
                  <Input type="number" step="0.01" min="0" value={(form as unknown as Record<string, string>)[f]}
                    onChange={(e) => setForm({ ...form, [f]: e.target.value })} />
                </div>
              ))}
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Gross (calc)</label>
                <Input readOnly value={gross.toFixed(2)} className="bg-slate-50 font-mono" />
              </div>
            </div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mt-2">Deductions</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {(['pf_employee_pct', 'pf_employer_pct', 'esi_employee_pct', 'esi_employer_pct', 'professional_tax'] as const).map((f) => (
                <div key={f}>
                  <label className="block text-xs font-medium text-slate-500 mb-1">{f.replace(/_pct/g, ' %').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</label>
                  <Input type="number" step="0.01" min="0" value={(form as unknown as Record<string, string>)[f]}
                    onChange={(e) => setForm({ ...form, [f]: e.target.value })} />
                </div>
              ))}
            </div>
            <div className="flex gap-3 justify-end pt-3">
              <DialogClose asChild><Button type="button" variant="secondary">Cancel</Button></DialogClose>
              <Button type="submit" disabled={saving}>{saving && <Loader2 size={14} className="animate-spin" />} Save</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ─── Payroll Processing Tab ─────────────────────────────────────────────────

function PayrollProcessingTab() {
  const navigate = useNavigate()
  const periodRef = useRef<HTMLInputElement>(null)
  const [runs, setRuns] = useState<PayrollRunData[]>([])
  const [loading, setLoading] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [period, setPeriod] = useState(getCurrentPeriod())
  // Marking a run paid POSTS a payment. It used to be one unconfirmed
  // keystroke on a button buried deep in the tab order; now it is a confirm.
  const [payingRun, setPayingRun] = useState<PayrollRunData | null>(null)
  const [markingPaid, setMarkingPaid] = useState(false)
  // Alt+N posts a payroll journal for every employee in the period. A chord has
  // no click target to hesitate over, so the keyboard path asks first; the
  // button keeps the flow it always had.
  const [confirmProcess, setConfirmProcess] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const res = await getPayrollRuns({ period })
      setRuns(res.results)
    } catch { toast.error('Failed to load payroll runs') }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [period])

  async function handleProcess() {
    setProcessing(true)
    try {
      const res = await processPayroll(period)
      toast.success(res.detail)
      load()
    } catch { toast.error('Failed to process payroll') }
    finally { setProcessing(false) }
  }

  async function handleMarkPaid() {
    if (!payingRun || markingPaid) return
    setMarkingPaid(true)
    try {
      await markPayrollPaid(payingRun.id)
      toast.success('Marked as paid')
      setPayingRun(null)
      load()
    } catch { toast.error('Failed to mark paid') }
    finally { setMarkingPaid(false) }
  }

  const totalGross = runs.reduce((s, r) => s + Number(r.gross_salary), 0)
  const totalNet = runs.reduce((s, r) => s + Number(r.net_salary), 0)

  const list = useListKeyboardNav({
    count: runs.length,
    onActivate: (i) => { if (runs[i].status === 'processed') setPayingRun(runs[i]) },
  })

  usePageKeyboard({
    actions: [
      { chord: 'Alt+N', label: 'Process payroll', run: () => setConfirmProcess(true), when: !processing },
      { chord: 'Alt+R', label: 'Refresh', run: load },
    ],
    searchRef: periodRef,
    onFocusList: list.focusList,
    onBack: () => navigate(-1),
  })

  return (
    <div>
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <label className="text-xs text-slate-500 font-medium">Period</label>
          <Input ref={periodRef} type="month" value={period} onChange={(e) => setPeriod(e.target.value)} className="w-full sm:w-auto px-2.5 py-1.5" />
        </div>
        <Button onClick={handleProcess} disabled={processing} className="w-full sm:w-auto">
          {processing ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
          Process Payroll
        </Button>
      </div>

      <Card className="overflow-hidden">
        <Table>
          <Thead>
            <Tr className="bg-slate-50">
              <Th>Employee</Th>
              <Th className="text-right">Gross</Th>
              <Th className="text-right">PF</Th>
              <Th className="text-right">ESI</Th>
              <Th className="text-right">PT</Th>
              <Th className="text-right">Net Salary</Th>
              <Th>Status</Th>
              <Th>Journal</Th>
              <Th className="w-20" />
            </Tr>
          </Thead>
          <Tbody {...list.containerProps}>
            {loading ? (
              <tr><td colSpan={9} className="text-center py-12"><Loader2 size={24} className="animate-spin inline text-teal-600" /></td></tr>
            ) : runs.length === 0 ? (
              <tr><td colSpan={9} className="text-center py-12 text-slate-400 text-sm">No payroll runs for this period</td></tr>
            ) : runs.map((run, i) => {
              const rowKb = list.rowProps(i)
              // Only a processed run can be marked paid. rowProps stamps
              // role="button" on every row of an activatable list, and the
              // stylesheet gives that role a pointer cursor — so a draft or
              // already-paid row was announced as a button and painted as one
              // while Enter and Space did nothing. Those rows keep the arrow
              // navigation and the focus rail, and drop the promise.
              const payable = run.status === 'processed'
              return (
              <Tr
                key={run.id}
                aria-label={`${run.employee_name} — ${run.status}${payable ? ', Enter to mark paid' : ''}`}
                {...rowKb}
                role={payable ? rowKb.role : undefined}
                onKeyDown={(e) => { if (e.target === e.currentTarget) rowKb.onKeyDown(e) }}
              >
                <Td>
                  <span className="font-mono text-xs text-slate-500 mr-2">{run.employee_code}</span>
                  <span className="font-medium">{run.employee_name}</span>
                </Td>
                <Td className="text-right font-mono text-sm">{formatCurrency(run.gross_salary)}</Td>
                <Td className="text-right font-mono text-sm text-slate-500">{formatCurrency(run.pf_employee)}</Td>
                <Td className="text-right font-mono text-sm text-slate-500">{formatCurrency(run.esi_employee)}</Td>
                <Td className="text-right font-mono text-sm text-slate-500">{formatCurrency(run.professional_tax)}</Td>
                <Td className="text-right font-mono text-sm font-semibold">{formatCurrency(run.net_salary)}</Td>
                <Td>
                  <Badge variant={run.status === 'paid' ? 'success' : run.status === 'processed' ? 'info' : 'warning'}>
                    {run.status}
                  </Badge>
                </Td>
                <Td className="text-xs font-mono text-teal-600">{run.journal_entry_no || '-'}</Td>
                <Td>
                  {run.status === 'processed' && (
                    <Button variant="ghost" size="sm"
                      aria-label={`Mark ${run.employee_name}'s payroll as paid`}
                      onClick={() => setPayingRun(run)}
                      className="text-xs bg-teal-50 hover:bg-teal-100 text-teal-600">
                      <CreditCard size={12} /> Pay
                    </Button>
                  )}
                </Td>
              </Tr>
              )
            })}
          </Tbody>
          {runs.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
                <td className="py-3 px-4 text-sm text-slate-500">Totals ({runs.length} employees)</td>
                <td className="py-3 px-4 text-right font-mono text-sm">{formatCurrency(totalGross)}</td>
                <td colSpan={3} />
                <td className="py-3 px-4 text-right font-mono text-sm">{formatCurrency(totalNet)}</td>
                <td colSpan={3} />
              </tr>
            </tfoot>
          )}
        </Table>
      </Card>

      <ConfirmDialog
        open={confirmProcess}
        onOpenChange={setConfirmProcess}
        title={`Process payroll for ${period}?`}
        description="Calculates every active employee's salary for the period and posts the payroll journal entries."
        confirmLabel="Process payroll"
        // Posts a journal per employee, so the dialog opens on Cancel: Alt+N is
        // a chord, and the Enter that follows it must not be the Enter that
        // posts. Same reason the mark-paid confirm below is a danger tone.
        tone="danger"
        onConfirm={() => { setConfirmProcess(false); handleProcess() }}
        loading={processing}
      />

      <ConfirmDialog
        open={!!payingRun}
        onOpenChange={(o) => { if (!o) setPayingRun(null) }}
        title="Mark payroll run as paid?"
        description={payingRun
          ? `${payingRun.employee_name} · net ${formatCurrency(payingRun.net_salary)} for ${period}. This posts the payment and cannot be undone from here.`
          : undefined}
        confirmLabel="Mark paid"
        // Opened by Enter on the focused run row — the same key would otherwise
        // land on "Mark paid" and post the payment on a double-tap.
        tone="danger"
        onConfirm={handleMarkPaid}
        loading={markingPaid}
      />
    </div>
  )
}

// ─── Main Page ──────────────────────────────────────────────────────────────

export default function PayrollPage() {
  return (
    <div className="max-w-7xl mx-auto space-y-5">
      <div>
        <h1 className="text-lg sm:text-xl font-semibold" style={{ color: 'var(--ink)', letterSpacing: '-0.01em' }}>Payroll</h1>
        <p className="text-sm mt-0.5" style={{ color: 'var(--ink-2)' }}>Employee management and salary processing.</p>
      </div>

      <Tabs defaultValue="employees">
        <TabsList>
          <TabsTrigger value="employees">Employees</TabsTrigger>
          <TabsTrigger value="structures">Salary Structures</TabsTrigger>
          <TabsTrigger value="processing">Payroll Processing</TabsTrigger>
        </TabsList>
        <TabsContent value="employees"><EmployeesTab /></TabsContent>
        <TabsContent value="structures"><SalaryStructuresTab /></TabsContent>
        <TabsContent value="processing"><PayrollProcessingTab /></TabsContent>
      </Tabs>
    </div>
  )
}
