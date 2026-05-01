import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Loader2, Landmark, AlertCircle, CreditCard, Wallet } from 'lucide-react'
import { toast } from 'sonner'
import {
  getBankAccounts, createBankAccount, getChartOfAccounts,
  type BankAccount, type Account,
} from '../../lib/api'
import { formatCurrency } from '../../lib/utils'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { Input } from '../../components/ui/input'
import { EmptyState } from '../../components/ui/EmptyState'
import { SkeletonCard } from '../../components/ui/Skeletons'
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetBody, SheetFooter, SheetClose, SheetTrigger,
} from '../../components/ui/sheet'

const ACCOUNT_TYPES = [
  { v: 'bank', label: 'Bank Account', icon: Landmark },
  { v: 'credit_card', label: 'Credit Card', icon: CreditCard },
  { v: 'cash', label: 'Cash', icon: Wallet },
] as const

export default function BankingPage() {
  const [accounts, setAccounts] = useState<BankAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [glAccounts, setGlAccounts] = useState<Account[]>([])

  async function load() {
    setLoading(true)
    try {
      const [accs, gl] = await Promise.all([getBankAccounts(), getChartOfAccounts()])
      setAccounts(accs)
      setGlAccounts(gl)
    } catch {
      toast.error('Failed to load bank accounts')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--ink)', letterSpacing: '-0.01em' }}>Banking</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--ink-2)' }}>
            Reconcile bank statements against your books and categorize uncoded transactions.
          </p>
        </div>
        <NewBankAccountSheet glAccounts={glAccounts} onCreated={load} />
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : accounts.length === 0 ? (
        <EmptyState
          icon={Landmark}
          title="No bank or cash accounts yet"
          description="Add a bank, credit card, or cash account to import statements and start matching transactions."
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {accounts.map((a) => {
            const meta = ACCOUNT_TYPES.find((t) => t.v === a.account_type) || ACCOUNT_TYPES[0]
            const Icon = meta.icon
            const bookBal = parseFloat(a.book_balance) || 0
            const stmtBal = parseFloat(a.statement_balance) || 0
            const diff = stmtBal - bookBal
            return (
              <Link key={a.id} to={`/banking/${a.id}`} className="block group">
                <Card className="p-5 h-full card-hover">
                  <div className="flex items-start justify-between mb-3">
                    <div
                      className="w-10 h-10 rounded-lg flex items-center justify-center"
                      style={{ background: 'rgba(15,157,154,0.10)', color: 'var(--brand)' }}
                    >
                      <Icon size={18} />
                    </div>
                    {a.unmatched_count > 0 && (
                      <span
                        className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded font-medium mono"
                        style={{ background: 'rgba(199,122,17,0.10)', color: 'var(--warning)' }}
                      >
                        <AlertCircle size={11} /> {a.unmatched_count} for review
                      </span>
                    )}
                  </div>
                  <div className="font-semibold mb-0.5 group-hover:underline" style={{ color: 'var(--ink)' }}>
                    {a.name}
                  </div>
                  <div className="text-xs mb-3 truncate" style={{ color: 'var(--ink-2)' }}>
                    {a.bank_name || meta.label}
                    {a.account_number && (
                      <span className="mono"> · ****{a.account_number.slice(-4)}</span>
                    )}
                  </div>
                  <div className="space-y-1.5 pt-3 border-t" style={{ borderColor: 'var(--line)' }}>
                    <div className="flex items-center justify-between text-sm">
                      <span style={{ color: 'var(--ink-2)' }}>Balance per books</span>
                      <span className="mono font-semibold" style={{ color: 'var(--ink)' }}>{formatCurrency(bookBal)}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span style={{ color: 'var(--ink-2)' }}>Balance per statement</span>
                      <span className="mono font-medium" style={{ color: 'var(--ink)' }}>{formatCurrency(stmtBal)}</span>
                    </div>
                    {Math.abs(diff) > 0.005 && (
                      <div className="flex items-center justify-between text-xs pt-1 border-t" style={{ borderColor: 'var(--line)' }}>
                        <span style={{ color: 'var(--ink-3)' }}>Difference</span>
                        <span
                          className="mono"
                          style={{ color: diff > 0 ? 'var(--warning)' : 'var(--danger)' }}
                        >
                          {diff > 0 ? '+' : ''}{formatCurrency(diff)}
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="text-xs mt-3 mono" style={{ color: 'var(--ink-3)' }}>
                    GL: {a.chart_account_code} {a.chart_account_name}
                  </div>
                </Card>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}

function NewBankAccountSheet({ glAccounts, onCreated }: { glAccounts: Account[]; onCreated: () => void }) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [name, setName] = useState('')
  const [accountType, setAccountType] = useState<'bank' | 'credit_card' | 'cash'>('bank')
  const [bankName, setBankName] = useState('')
  const [accountNumber, setAccountNumber] = useState('')
  const [ifsc, setIfsc] = useState('')
  const [chartAccount, setChartAccount] = useState<number | ''>('')
  const [openingBalance, setOpeningBalance] = useState('0.00')
  const [openingDate, setOpeningDate] = useState(() => {
    const d = new Date()
    return `${d.getFullYear()}-04-01`
  })

  // Only Bank/Cash leaf accounts make sense as the GL backing for a bank account
  const eligibleGl = glAccounts.filter((g) =>
    g.is_active !== false && g.is_leaf &&
    (g.account_subtype === 'Bank' || g.account_subtype === 'Cash')
  )

  function reset() {
    setName(''); setAccountType('bank'); setBankName(''); setAccountNumber('')
    setIfsc(''); setChartAccount(''); setOpeningBalance('0.00')
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!chartAccount) { toast.error('Pick a backing GL account'); return }
    setSaving(true)
    try {
      await createBankAccount({
        name, account_type: accountType,
        bank_name: bankName, account_number: accountNumber, ifsc,
        chart_account: Number(chartAccount),
        opening_balance: openingBalance,
        opening_date: openingDate || null,
        is_active: true,
      })
      toast.success('Bank account added')
      setOpen(false)
      reset()
      onCreated()
    } catch (err) {
      const e = err as { response?: { data?: Record<string, unknown> } }
      const data = e.response?.data
      const msg = data
        ? Object.entries(data).map(([k, v]) =>
            `${k}: ${Array.isArray(v) ? v.join(', ') : String(v)}`).join(' • ')
        : 'Failed to save'
      toast.error(msg)
    } finally { setSaving(false) }
  }

  return (
    <Sheet open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset() }}>
      <SheetTrigger asChild>
        <Button><Plus size={16} /> Add Bank Account</Button>
      </SheetTrigger>
      <SheetContent width="md">
        <form onSubmit={submit} className="flex flex-col h-full">
          <SheetHeader><SheetTitle>Add Bank / Cash Account</SheetTitle></SheetHeader>
          <SheetBody>
            <div className="space-y-3">
              <Field label="Display Name" required>
                <Input value={name} onChange={(e) => setName(e.target.value)} required
                  placeholder="e.g. HDFC Current Account" />
              </Field>
              <Field label="Type" required>
                <div className="flex gap-2">
                  {ACCOUNT_TYPES.map((t) => (
                    <label key={t.v}
                      className={
                        'flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg border cursor-pointer text-sm ' +
                        (accountType === t.v
                          ? 'border-teal-500 bg-teal-50 text-teal-700'
                          : 'border-slate-200 text-slate-600 hover:border-slate-300')
                      }>
                      <input type="radio" checked={accountType === t.v}
                        onChange={() => setAccountType(t.v)} className="hidden" />
                      <t.icon size={14} /> {t.label}
                    </label>
                  ))}
                </div>
              </Field>
              {accountType !== 'cash' && (
                <>
                  <Field label="Bank Name">
                    <Input value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="e.g. HDFC Bank" />
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Account Number">
                      <Input value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} />
                    </Field>
                    <Field label="IFSC">
                      <Input value={ifsc} onChange={(e) => setIfsc(e.target.value.toUpperCase())} />
                    </Field>
                  </div>
                </>
              )}
              <Field label="Backing GL Account" required hint="Bank or Cash leaf account from chart of accounts">
                <select value={chartAccount} onChange={(e) => setChartAccount(e.target.value ? Number(e.target.value) : '')}
                  required
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white">
                  <option value="">— Select —</option>
                  {eligibleGl.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.account_code} — {g.account_name} ({g.account_subtype})
                    </option>
                  ))}
                </select>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Opening Balance">
                  <Input type="number" step="0.01" value={openingBalance}
                    onChange={(e) => setOpeningBalance(e.target.value)} className="text-right font-mono" />
                </Field>
                <Field label="Opening Date">
                  <Input type="date" value={openingDate} onChange={(e) => setOpeningDate(e.target.value)} />
                </Field>
              </div>
            </div>
          </SheetBody>
          <SheetFooter>
            <SheetClose asChild><Button type="button" variant="secondary">Cancel</Button></SheetClose>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="animate-spin" size={14} />} Save
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}

function Field({ label, required, hint, children }: {
  label: string
  required?: boolean
  hint?: string
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-slate-600 mb-1.5">
        {label} {required && <span className="text-rose-500">*</span>}
      </span>
      {children}
      {hint && <span className="block text-xs text-slate-400 mt-1">{hint}</span>}
    </label>
  )
}
