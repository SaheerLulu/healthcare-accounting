import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Loader2, Send, Globe } from 'lucide-react'
import { toast } from 'sonner'
import {
  getChartOfAccounts, getSuppliers, createPaymentVoucher,
  type Account, type Party,
} from '../../lib/api'
import { formatCurrency } from '../../lib/utils'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Card } from '../../components/ui/card'
import { useLocation as useActiveLocation } from '../../contexts/LocationContext'
import { useHotkeys, useHintRegister, type HotkeyHandler, type HotkeyHint } from '../../contexts/HotkeyContext'
import { PartySearchPicker } from '../parties/PartySearchPicker'

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

/**
 * Simplified Payment voucher (F5). Always books:
 *   Dr  Trade Payables   ₹amount  (party_id required)
 *       Cr  Bank / Cash       ₹amount
 *
 * No ledger-table editor — pick party + amount + mode and submit. The
 * voucher number is auto-assigned on the server; we show "Auto on save"
 * in the header chip until that round-trip completes.
 */
export default function PaymentVoucherPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const initialPartyId = searchParams.get('party_id')
    ? Number(searchParams.get('party_id'))
    : null
  const { activeLocationId } = useActiveLocation()

  const [parties, setParties] = useState<Party[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [partyId, setPartyId] = useState<number | ''>(initialPartyId ?? '')
  const [date, setDate] = useState(todayStr())
  const [amount, setAmount] = useState('')
  const [mode, setMode] = useState<'bank' | 'cash'>('bank')
  const [bankAccountId, setBankAccountId] = useState<number | null>(null)
  const [narration, setNarration] = useState('')
  const [loading, setLoading] = useState(true)
  const [posting, setPosting] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const [accs, ps] = await Promise.all([getChartOfAccounts(), getSuppliers()])
        if (cancelled) return
        setAccounts(accs)
        setParties(ps)
      } catch { /* ignore */ }
      finally { if (!cancelled) setLoading(false) }
    }
    load()
    return () => { cancelled = true }
  }, [])

  // Bank-subtype accounts only (so the picker stays scoped to actual banks).
  const bankAccounts = useMemo(
    () => accounts.filter((a) => a.account_subtype === 'Bank' && a.is_active),
    [accounts],
  )

  // Auto-pick the first bank account when switching to Bank mode for the
  // first time. The user can still change it.
  useEffect(() => {
    if (mode === 'bank' && bankAccountId === null && bankAccounts.length > 0) {
      setBankAccountId(bankAccounts[0].id)
    }
  }, [mode, bankAccountId, bankAccounts])

  const allStores = activeLocationId === null
  const amountNum = parseFloat(amount) || 0

  function validate(): string | null {
    if (allStores) return 'Switch to a specific store from the top-nav selector to record vouchers'
    if (!partyId) return 'Pick the supplier you are paying'
    if (amountNum <= 0) return 'Enter the payment amount'
    if (mode === 'bank' && !bankAccountId) return 'Choose which bank account this is paid from'
    return null
  }

  async function handleSubmit() {
    const err = validate()
    if (err) { toast.error(err); return }
    setPosting(true)
    try {
      const entry = await createPaymentVoucher({
        date,
        amount: String(amountNum),
        party_id: Number(partyId),
        payment_mode: mode,
        bank_account_id: mode === 'bank' ? bankAccountId : null,
        narration: narration || (mode === 'bank' ? 'Bank payment' : 'Cash payment'),
        location_id: activeLocationId as number,
      })
      toast.success(`${entry.entry_no} posted`)
      navigate('/')
    } catch (err) {
      const e = err as { response?: { data?: { detail?: string } } }
      toast.error(e.response?.data?.detail || 'Failed to post payment')
    } finally {
      setPosting(false)
    }
  }

  // ─── Hotkeys ─────────────────────────────────────────────────────────────
  const handlers = useMemo<HotkeyHandler[]>(() => [
    { chord: 'Ctrl+A', preventDefault: true, handler: handleSubmit },
    { chord: 'Escape', preventDefault: false, handler: () => navigate('/') },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [date, amount, partyId, mode, bankAccountId, narration, activeLocationId])

  useHotkeys(handlers)

  const hints = useMemo<HotkeyHint[]>(() => [
    { chord: 'Ctrl+A', label: 'Save & Post' },
    { chord: 'Esc', label: 'Cancel' },
  ], [])
  useHintRegister(hints)

  if (loading) {
    return (
      <div className="p-12 text-center">
        <Loader2 className="animate-spin inline" size={24} style={{ color: 'var(--brand)' }} />
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto space-y-4 pb-32">
      <button
        onClick={() => navigate('/')}
        className="inline-flex items-center gap-1 text-sm hover:opacity-80 mb-1"
        style={{ color: 'var(--ink-2)' }}
      >
        <ArrowLeft size={14} /> Gateway
      </button>

      {allStores && (
        <div
          className="mb-3 px-4 py-2.5 rounded-lg flex items-center gap-2.5 text-sm"
          style={{
            background: 'rgba(245, 158, 11, 0.08)',
            border: '1px solid rgba(245, 158, 11, 0.30)',
            color: 'var(--ink)',
          }}
        >
          <Globe size={14} style={{ color: 'rgb(180,110,0)' }} />
          <span className="font-medium">All Stores is read-only.</span>
          <span style={{ color: 'var(--ink-2)' }}>
            Switch to a specific store from the selector at the top to record this voucher.
          </span>
        </div>
      )}

      <div className="flex items-baseline gap-3 flex-wrap">
        <span
          className="mono text-xs font-bold px-2 py-0.5 rounded"
          style={{
            background: 'rgba(15,157,154,0.12)',
            color: 'var(--brand)',
            border: '1px solid rgba(15,157,154,0.25)',
          }}
        >
          F5
        </span>
        <h1 className="text-xl font-semibold" style={{ color: 'var(--ink)', letterSpacing: '-0.01em' }}>
          Payment Voucher
        </h1>
        <span
          className="mono text-xs font-semibold px-2 py-0.5 rounded"
          style={{
            background: 'var(--surface-1)',
            color: 'var(--ink-2)',
            border: '1px solid var(--line)',
          }}
          title="Voucher # is assigned on save"
        >
          # Auto on save
        </span>
        <span className="text-sm" style={{ color: 'var(--ink-2)' }}>
          · Record a supplier payment
        </span>
      </div>

      <Card className="p-5 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Date" required>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Supplier" required hint="Type letters to narrow · ↑↓ Enter">
            <PartySearchPicker
              parties={parties}
              value={partyId}
              onChange={(id) => setPartyId(id)}
              storageKey="Supplier"
              placeholder="Search supplier…"
            />
          </Field>
        </div>

        <Field label="Amount" required>
          <Input
            type="number" inputMode="decimal" step="0.01" min="0"
            value={amount} onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            className="text-right font-mono"
          />
        </Field>

        <Field label="Paid via" required>
          <div className="flex gap-2">
            <ModeOption
              label="Bank" active={mode === 'bank'} onClick={() => setMode('bank')}
            />
            <ModeOption
              label="Cash" active={mode === 'cash'} onClick={() => setMode('cash')}
            />
          </div>
        </Field>

        {mode === 'bank' && (
          <Field label="Bank account" required>
            {bankAccounts.length === 0 ? (
              <div className="text-sm py-2 px-3 rounded border" style={{
                color: 'var(--warning)',
                background: 'rgba(245,158,11,0.06)',
                borderColor: 'rgba(245,158,11,0.30)',
              }}>
                No bank-subtype accounts found in Chart of Accounts. Create one first.
              </div>
            ) : (
              <select
                value={bankAccountId ?? ''}
                onChange={(e) => setBankAccountId(e.target.value ? Number(e.target.value) : null)}
                className="w-full h-9 px-3 text-sm border rounded-md outline-none focus:shadow-[0_0_0_3px_rgba(15,157,154,0.18)]"
                style={{ backgroundColor: 'var(--surface-0)', borderColor: 'var(--line)', color: 'var(--ink)' }}
              >
                {bankAccounts.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.account_code} — {b.account_name}
                  </option>
                ))}
              </select>
            )}
          </Field>
        )}

        <Field label="Narration" hint="Optional — shown in Day Book and reports">
          <Input
            value={narration}
            onChange={(e) => setNarration(e.target.value)}
            placeholder={mode === 'bank' ? 'Bank payment' : 'Cash payment'}
          />
        </Field>
      </Card>

      {amountNum > 0 && (
        <div className="text-right text-sm" style={{ color: 'var(--ink-2)' }}>
          Will book: <span className="font-mono font-semibold" style={{ color: 'var(--ink)' }}>
            Dr Trade Payables {formatCurrency(amount)} / Cr {mode === 'bank' ? (
              bankAccounts.find((b) => b.id === bankAccountId)?.account_name ?? 'Bank'
            ) : 'Cash'} {formatCurrency(amount)}
          </span>
        </div>
      )}

      <div
        className="fixed left-0 right-0 z-20 px-6 py-3 flex items-center justify-end gap-2"
        style={{
          bottom: 36,
          background: 'var(--surface-0)',
          borderTop: '1px solid var(--line)',
          boxShadow: '0 -4px 12px rgba(0,0,0,0.04)',
        }}
      >
        <Button variant="secondary" onClick={() => navigate('/')}>
          Cancel <kbd className="hidden md:inline mono text-[10px] ml-1" style={{ color: 'var(--ink-3)' }}>Esc</kbd>
        </Button>
        <Button onClick={handleSubmit} disabled={posting || allStores}>
          {posting ? <Loader2 className="animate-spin" size={14} /> : <Send size={14} />}
          Save & Post
          <kbd className="hidden md:inline mono text-[10px] ml-1 text-white/80">Ctrl+A</kbd>
        </Button>
      </div>
    </div>
  )
}

function ModeOption({ label, active, onClick }: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex-1 px-4 py-2 rounded-md text-sm transition-colors"
      style={{
        background: active ? 'rgba(15,157,154,0.10)' : 'var(--surface-0)',
        border: `1px solid ${active ? 'rgba(15,157,154,0.40)' : 'var(--line)'}`,
        color: active ? 'var(--brand)' : 'var(--ink-2)',
        fontWeight: active ? 600 : 400,
      }}
    >
      {label}
    </button>
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
      <span className="block text-xs font-medium mb-1.5" style={{ color: 'var(--ink-2)' }}>
        {label} {required && <span style={{ color: 'var(--danger)' }}>*</span>}
      </span>
      {children}
      {hint && <span className="block text-xs mt-1" style={{ color: 'var(--ink-3)' }}>{hint}</span>}
    </label>
  )
}
