import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft, Loader2, Plus, Save, Send, History, Layers, Globe, Banknote, Wallet,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  getChartOfAccounts, getJournalEntry, getJournalEntries,
  getSuppliers, getCustomers,
  createJournalEntry, updateJournalEntry, postEntry,
  createBillReference,
  type Account, type JournalEntry, type Party, type JournalLine,
} from '../../lib/api'
import { formatCurrency } from '../../lib/utils'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Card } from '../../components/ui/card'
import { Badge } from '../../components/ui/badge'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { useLocation as useActiveLocation } from '../../contexts/LocationContext'
import { useHotkeys, useHintRegister, type HotkeyHandler, type HotkeyHint } from '../../contexts/HotkeyContext'
import { AccountPicker } from '../journals/AccountPicker'
import { PartySearchPicker } from '../parties/PartySearchPicker'
import { CreateLedgerModal } from './CreateLedgerModal'
import { CostCenterPopup } from './CostCenterPopup'
import { PaymentRowEditor, type PaymentRow } from './PaymentRowEditor'

type PartyKind = 'Supplier' | 'Customer'

function uid() {
  return Math.random().toString(36).slice(2)
}

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

function makeRow(partyKind: PartyKind | null, partyId: number | null = null): PaymentRow {
  return {
    uid: uid(),
    party_type: partyKind,
    party_id: partyId,
    account_id: null,
    amount: '',
    narration: '',
    ref: null,
  }
}

function isPostable(a: Account): boolean {
  if (a.is_active === false) return false
  if (a.children && a.children.length > 0 && !a.is_leaf) return false
  return true
}

function bankCashFilter(mode: 'bank' | 'cash') {
  return (a: Account) =>
    isPostable(a) && (mode === 'bank' ? a.account_subtype === 'Bank' : a.account_subtype === 'Cash')
}

function rowAccountFilter(a: Account): boolean {
  if (!isPostable(a)) return false
  // Bank/Cash are excluded — those belong on the Cr side, which is the header field.
  if (a.account_subtype === 'Bank' || a.account_subtype === 'Cash') return false
  return (
    a.account_subtype === 'Payable' ||
    a.account_subtype === 'Receivable' ||
    a.account_type === 'EXPENSE' ||
    a.account_type === 'ASSET' ||
    a.account_type === 'LIABILITY'
  )
}

/**
 * Default Dr ledger for a row given its party type:
 *   Supplier → first Payable account (e.g. 2110 Trade Payables)
 *   Customer → first Receivable account (e.g. 1130 Trade Receivables)
 */
function suggestLedgerForParty(accounts: Account[], partyKind: PartyKind | null): number | null {
  if (!partyKind) return null
  const subtype = partyKind === 'Supplier' ? 'Payable' : 'Receivable'
  const match = accounts.find((a) => isPostable(a) && a.account_subtype === subtype)
  return match?.id ?? null
}

export default function SimplePaymentVoucher() {
  const { id } = useParams<{ id?: string }>()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const editingId = id ? Number(id) : null
  const { activeLocationId } = useActiveLocation()
  const initialPartyId = searchParams.get('party_id')
    ? Number(searchParams.get('party_id'))
    : null

  const [accounts, setAccounts] = useState<Account[]>([])
  const [suppliers, setSuppliers] = useState<Party[]>([])
  const [customers, setCustomers] = useState<Party[]>([])

  const [date, setDate] = useState(todayStr())
  const [paymentMode, setPaymentMode] = useState<'bank' | 'cash'>('bank')
  const [bankCashId, setBankCashId] = useState<number | null>(null)
  const [defaultPartyType, setDefaultPartyType] = useState<PartyKind>('Supplier')
  const [defaultPartyId, setDefaultPartyId] = useState<number | ''>('')
  const [narration, setNarration] = useState('Being payment')
  const [costCenter, setCostCenter] = useState('')
  const [costCentreId, setCostCentreId] = useState<number | null>(null)
  const [voucherTypeProfileId, setVoucherTypeProfileId] = useState<number | null>(null)

  const [rows, setRows] = useState<PaymentRow[]>([makeRow('Supplier')])

  const [loading, setLoading] = useState(!!editingId)
  const [saving, setSaving] = useState(false)
  const [posting, setPosting] = useState(false)
  const [originalEntry, setOriginalEntry] = useState<JournalEntry | null>(null)
  const [escConfirmOpen, setEscConfirmOpen] = useState(false)
  const [createLedgerOpen, setCreateLedgerOpen] = useState(false)
  const [costCenterOpen, setCostCenterOpen] = useState(false)
  const altCRowUidRef = useRef<string | null>(null)

  // ─── Initial load ──────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const [accs, sups, custs] = await Promise.all([
          getChartOfAccounts(), getSuppliers(), getCustomers(),
        ])
        if (cancelled) return
        setAccounts(accs)
        setSuppliers(sups)
        setCustomers(custs)

        // Default the bank account to the first active Bank ledger; if no bank
        // is set up at all, flip to cash mode so the user isn't stuck.
        const firstBank = accs.find((a) => isPostable(a) && a.account_subtype === 'Bank')
        const firstCash = accs.find((a) => isPostable(a) && a.account_subtype === 'Cash')
        if (firstBank) {
          setBankCashId(firstBank.id)
          setPaymentMode('bank')
        } else if (firstCash) {
          setBankCashId(firstCash.id)
          setPaymentMode('cash')
        }

        // ?party_id=… from a quick-action link starts a row pre-populated for
        // that supplier.
        if (initialPartyId && !editingId) {
          const s = sups.find((p) => p.id === initialPartyId)
          if (s) {
            setDefaultPartyId(s.id)
            setRows([{
              ...makeRow('Supplier', s.id),
              account_id: suggestLedgerForParty(accs, 'Supplier'),
            }])
            if (narration === 'Being payment') {
              setNarration(`Being payment to ${s.name}`)
            }
          }
        }
      } catch {
        toast.error('Failed to load voucher data')
      }
      if (editingId) {
        try {
          const entry = await getJournalEntry(editingId)
          if (cancelled) return
          if (entry.is_posted) {
            toast.error('Posted entries cannot be edited — reverse it instead')
            navigate(`/journals/${editingId}`, { replace: true })
            return
          }
          setOriginalEntry(entry)
          setDate(entry.date)
          setNarration(entry.narration || '')
          setCostCenter(entry.cost_center || '')
          setCostCentreId(entry.cost_centre ?? null)
          setVoucherTypeProfileId(entry.voucher_type_profile ?? null)
          hydrateFromEntry(entry)
        } catch {
          toast.error('Failed to load voucher')
        }
      }
      if (!cancelled) setLoading(false)
    }
    load()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId])

  /**
   * Re-create header + rows from a saved JournalEntry. The Cr line is the
   * bank/cash header; Dr lines become rows.
   */
  function hydrateFromEntry(entry: JournalEntry) {
    const cr = entry.lines.find((l) => parseFloat(l.credit) > 0)
    const drLines = entry.lines.filter((l) => parseFloat(l.debit) > 0)
    if (cr) {
      setBankCashId(cr.account)
      // Best-effort mode detection — if the account's subtype is Cash, switch.
      // We don't always have the subtype on the line — fall back to bank.
      setPaymentMode('bank')
    }
    setRows(
      drLines.length > 0
        ? drLines.map((l): PaymentRow => {
            const pt = l.party_type
            const partyKind: PartyKind | null =
              pt === 'Supplier' || pt === 'Customer' ? pt : null
            return {
              uid: uid(),
              party_type: partyKind,
              party_id: l.party_id ?? null,
              account_id: l.account,
              amount: l.debit,
              narration: l.narration || '',
              // Bill references are not re-hydrated here — they'd need a separate
              // fetch via listBillReferences and are not edit-critical for v1.
              ref: null,
            }
          })
        : [makeRow('Supplier')]
    )
  }

  // ─── Derived ───────────────────────────────────────────────────────────────
  const total = useMemo(() => rows.reduce(
    (s, r) => s + (parseFloat(r.amount) || 0),
    0
  ), [rows])

  const bankCashAccount = useMemo(
    () => accounts.find((a) => a.id === bankCashId) ?? null,
    [accounts, bankCashId]
  )

  const rowAccounts = useMemo(
    () => accounts.filter(rowAccountFilter),
    [accounts]
  )
  const bankAccounts = useMemo(
    () => accounts.filter(bankCashFilter('bank')),
    [accounts]
  )
  const cashAccounts = useMemo(
    () => accounts.filter(bankCashFilter('cash')),
    [accounts]
  )

  const isValid = useMemo(() => {
    if (activeLocationId === null) return false
    if (!bankCashId) return false
    const positiveRows = rows.filter(
      (r) => r.account_id && parseFloat(r.amount) > 0
    )
    if (positiveRows.length === 0) return false
    // Party-required check (mirrors backend validation for Receivable/Payable).
    for (const r of positiveRows) {
      const acc = accounts.find((a) => a.id === r.account_id)
      if (!acc) continue
      if ((acc.account_subtype === 'Payable' || acc.account_subtype === 'Receivable')
          && !r.party_id) {
        return false
      }
    }
    return true
  }, [activeLocationId, bankCashId, rows, accounts])

  const allStores = activeLocationId === null

  // ─── Row helpers ───────────────────────────────────────────────────────────
  function patchRow(uid: string, patch: Partial<PaymentRow>) {
    setRows((rs) => rs.map((r) => {
      if (r.uid !== uid) return r
      const next = { ...r, ...patch }
      // When a party is just set and the row has no ledger yet, auto-suggest.
      if ('party_id' in patch && patch.party_id && !r.account_id) {
        const suggested = suggestLedgerForParty(accounts, next.party_type)
        if (suggested) next.account_id = suggested
      }
      return next
    }))
  }

  function addRow() {
    setRows((rs) => [
      ...rs,
      makeRow(defaultPartyType, defaultPartyId ? Number(defaultPartyId) : null),
    ])
  }

  function removeRow(uid: string) {
    setRows((rs) => rs.length <= 1 ? rs : rs.filter((r) => r.uid !== uid))
  }

  function applyDefaultPartyToEmptyRows(kind: PartyKind, pid: number | null) {
    setRows((rs) => rs.map((r) => {
      // Only touch rows that have no party yet — don't blow away user edits.
      if (r.party_id || (r.party_type && r.party_type !== kind)) return r
      const next: PaymentRow = { ...r, party_type: kind, party_id: pid }
      if (pid && !r.account_id) {
        const suggested = suggestLedgerForParty(accounts, kind)
        if (suggested) next.account_id = suggested
      }
      return next
    }))
  }

  // ─── Save / Post ───────────────────────────────────────────────────────────
  function buildPayload() {
    const positiveRows = rows.filter(
      (r) => r.account_id && parseFloat(r.amount) > 0
    )
    const total = positiveRows.reduce((s, r) => s + parseFloat(r.amount), 0)

    const lines: JournalLine[] = [
      ...positiveRows.map((r): JournalLine => ({
        account: r.account_id!,
        debit: parseFloat(r.amount).toFixed(2),
        credit: '0',
        narration: r.narration || '',
        // Backend uses 'None' (not null) as the no-party sentinel.
        party_type: r.party_type ?? 'None',
        party_id: r.party_id ?? null,
      })),
      {
        account: bankCashId!,
        debit: '0',
        credit: total.toFixed(2),
        narration: '',
        party_type: 'None',
        party_id: null,
      },
    ]
    return {
      date,
      narration,
      voucher_type: 'PAYMENT',
      voucher_type_profile: voucherTypeProfileId,
      reference_type: 'Manual',
      reference_id: null,
      cost_center: costCenter,
      cost_centre: costCentreId,
      location_id: activeLocationId as number,
      lines,
    }
  }

  function validationError(): string | null {
    if (activeLocationId === null) return 'Switch to a specific store from the top-nav selector to record vouchers'
    if (!bankCashId) return 'Select a Bank or Cash account to pay from'
    const positiveRows = rows.filter(
      (r) => r.account_id && parseFloat(r.amount) > 0
    )
    if (positiveRows.length === 0) return 'Add at least one debit line with a ledger and amount'
    for (let i = 0; i < positiveRows.length; i++) {
      const r = positiveRows[i]
      const acc = accounts.find((a) => a.id === r.account_id)
      if (!acc) continue
      if ((acc.account_subtype === 'Payable' || acc.account_subtype === 'Receivable')
          && !r.party_id) {
        return `Row ${i + 1}: ${acc.account_subtype} accounts need a party`
      }
    }
    return null
  }

  const handleSave = useCallback(async function handleSave(thenPost = false) {
    const err = validationError()
    if (err) { toast.error(err); return }
    setSaving(true)
    try {
      const positiveRows = rows.filter(
        (r) => r.account_id && parseFloat(r.amount) > 0
      )
      const payload = buildPayload()
      let entry: JournalEntry
      if (editingId) {
        entry = await updateJournalEntry(editingId, payload)
      } else {
        entry = await createJournalEntry(payload)
      }

      // Attach bill references — match rows to lines by order. The Cr line is
      // appended last, so the first N response lines align with positiveRows.
      const savedDrLines = entry.lines.filter((l) => parseFloat(l.debit) > 0)
      for (let i = 0; i < positiveRows.length; i++) {
        const r = positiveRows[i]
        const drLine = savedDrLines[i]
        if (!r.ref || !drLine?.id) continue
        try {
          await createBillReference({
            line: drLine.id,
            kind: r.ref.kind,
            bill_id: r.ref.bill_id,
            ref_no: r.ref.ref_no,
            ref_date: r.ref.ref_date,
            amount: parseFloat(r.amount).toFixed(2),
          })
        } catch { /* don't block save on a single ref failure */ }
      }

      if (thenPost) {
        setPosting(true)
        try {
          await postEntry(entry.id)
          toast.success(`${entry.entry_no} posted`)
          navigate('/')
          return
        } catch (err) {
          const e = err as { response?: { data?: { detail?: string } } }
          toast.error(e.response?.data?.detail || 'Saved as draft, but post failed')
        } finally { setPosting(false) }
      } else {
        toast.success(editingId ? `${entry.entry_no} saved` : `${entry.entry_no} created as draft`)
      }
      navigate(`/journals/${entry.id}`)
    } catch (err) {
      const e = err as { response?: { data?: Record<string, unknown> } }
      const data = e.response?.data
      const msg = data
        ? Object.entries(data).map(([k, v]) =>
            `${k}: ${Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? JSON.stringify(v) : String(v)}`).join(' • ')
        : 'Failed to save'
      toast.error(msg)
    } finally {
      setSaving(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, narration, rows, accounts, bankCashId, activeLocationId, editingId, costCenter, costCentreId, voucherTypeProfileId])

  // ─── Repeat last (Ctrl+H) ──────────────────────────────────────────────────
  const handleRepeatLast = useCallback(async () => {
    if (editingId) {
      toast.info('Ctrl+H only applies when creating a new voucher')
      return
    }
    try {
      const res = await getJournalEntries({ voucher_type: 'PAYMENT', is_posted: 'true' })
      const last = res.results?.[0]
      if (!last) {
        toast.info('No previous Payment voucher to repeat')
        return
      }
      hydrateFromEntry(last)
      setNarration(last.narration || '')
      toast.success(`Repeated ${last.entry_no} (${last.date})`)
    } catch {
      toast.error('Failed to fetch previous voucher')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId])

  // ─── Esc (confirm if dirty) ────────────────────────────────────────────────
  const handleEsc = useCallback(() => {
    const dirty = rows.some((r) => r.account_id || parseFloat(r.amount) > 0)
      || (narration && narration !== 'Being payment')
    if (dirty) setEscConfirmOpen(true)
    else navigate('/')
  }, [rows, narration, navigate])

  // ─── Alt+C ledger create ───────────────────────────────────────────────────
  const handleAltCFromRow = useCallback((rowUid: string) => {
    altCRowUidRef.current = rowUid
    setCreateLedgerOpen(true)
  }, [])

  const handleAltCGlobal = useCallback(() => {
    altCRowUidRef.current = null
    setCreateLedgerOpen(true)
  }, [])

  function handleLedgerCreated(acc: Account) {
    setAccounts((prev) => [acc, ...prev])
    const target = altCRowUidRef.current
    if (target) patchRow(target, { account_id: acc.id })
  }

  // ─── Hotkeys ───────────────────────────────────────────────────────────────
  const handlers = useMemo<HotkeyHandler[]>(() => [
    { chord: 'Ctrl+A', preventDefault: true, handler: () => handleSave(true) },
    { chord: 'Ctrl+H', preventDefault: true, handler: handleRepeatLast },
    { chord: 'Alt+C', preventDefault: true, handler: handleAltCGlobal },
    { chord: 'Ctrl+L', preventDefault: true, handler: () => setCostCenterOpen(true) },
    { chord: 'Escape', preventDefault: false, handler: handleEsc },
  ], [handleSave, handleRepeatLast, handleAltCGlobal, handleEsc])
  useHotkeys(handlers)

  const hints = useMemo<HotkeyHint[]>(() => [
    { chord: 'Ctrl+A', label: 'Save & Post' },
    { chord: 'Ctrl+H', label: 'Repeat Last' },
    { chord: 'Alt+C', label: 'New Ledger' },
    { chord: 'Ctrl+L', label: 'Cost Centre' },
    { chord: 'Esc', label: 'Cancel' },
  ], [])
  useHintRegister(hints)

  // ─── Render ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="p-12 text-center">
        <Loader2 className="animate-spin inline" size={24} style={{ color: 'var(--brand)' }} />
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto space-y-4 pb-32">
      <button
        onClick={handleEsc}
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

      <div className="flex items-start justify-between mb-3 gap-3 flex-wrap">
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
            {editingId ? `Edit ${originalEntry?.entry_no ?? 'Payment'}` : 'Payment Voucher'}
          </h1>
          <span
            className="mono text-xs font-semibold px-2 py-0.5 rounded"
            style={{
              background: 'var(--surface-1)',
              color: 'var(--ink-2)',
              border: '1px solid var(--line)',
            }}
            title={originalEntry?.entry_no ? 'Voucher #' : 'Voucher # will be assigned on save'}
          >
            # {originalEntry?.entry_no || 'Auto on save'}
          </span>
          <span className="text-sm" style={{ color: 'var(--ink-2)' }}>· Cash &amp; bank outflows</span>
          {(costCenter || costCentreId) && (
            <button
              type="button"
              onClick={() => setCostCenterOpen(true)}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] mono uppercase tracking-wide hover:opacity-90"
              style={{
                background: 'rgba(15,157,154,0.10)',
                color: 'var(--brand)',
                border: '1px solid rgba(15,157,154,0.25)',
              }}
              title="Cost Centre — Ctrl+L to change"
            >
              <Layers size={10} /> {costCenter || `Centre #${costCentreId}`}
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!costCenter && !costCentreId && (
            <Button variant="ghost" size="sm" onClick={() => setCostCenterOpen(true)}>
              <Layers size={14} /> Cost Centre
              <kbd className="hidden md:inline mono text-[10px] ml-1" style={{ color: 'var(--ink-3)' }}>Ctrl+L</kbd>
            </Button>
          )}
          {originalEntry && <Badge variant="warning">Draft</Badge>}
        </div>
      </div>

      <Card className="p-5">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
          <div className="md:col-span-2">
            <Field label="Date" required>
              <Input type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
          </div>

          <div className="md:col-span-4">
            <Field label="Paid from" required hint="The credit side of this voucher">
              <div className="flex gap-2">
                <div className="flex gap-0.5 rounded-md border overflow-hidden" style={{ borderColor: 'var(--line)' }}>
                  <ModeBtn
                    icon={<Banknote size={12} />}
                    label="Bank"
                    active={paymentMode === 'bank'}
                    onClick={() => {
                      setPaymentMode('bank')
                      const first = bankAccounts[0]
                      if (first) setBankCashId(first.id)
                    }}
                  />
                  <ModeBtn
                    icon={<Wallet size={12} />}
                    label="Cash"
                    active={paymentMode === 'cash'}
                    onClick={() => {
                      setPaymentMode('cash')
                      const first = cashAccounts[0]
                      if (first) setBankCashId(first.id)
                    }}
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <AccountPicker
                    accounts={paymentMode === 'bank' ? bankAccounts : cashAccounts}
                    value={bankCashId}
                    onChange={setBankCashId}
                  />
                </div>
              </div>
            </Field>
          </div>

          <div className="md:col-span-6">
            <Field
              label="Pay to (default)"
              hint="Used as the starting party for new rows — each row can override"
            >
              <div className="flex gap-2">
                <div className="flex gap-0.5 rounded-md border overflow-hidden" style={{ borderColor: 'var(--line)' }}>
                  <ModeBtn
                    label="Supplier"
                    active={defaultPartyType === 'Supplier'}
                    onClick={() => {
                      setDefaultPartyType('Supplier')
                      setDefaultPartyId('')
                    }}
                  />
                  <ModeBtn
                    label="Customer"
                    active={defaultPartyType === 'Customer'}
                    onClick={() => {
                      setDefaultPartyType('Customer')
                      setDefaultPartyId('')
                    }}
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <PartySearchPicker
                    parties={defaultPartyType === 'Customer' ? customers : suppliers}
                    value={defaultPartyId}
                    onChange={(id) => {
                      setDefaultPartyId(id)
                      const pid = id === '' ? null : Number(id)
                      applyDefaultPartyToEmptyRows(defaultPartyType, pid)
                      if (pid) {
                        const p = (defaultPartyType === 'Customer' ? customers : suppliers).find((x) => x.id === pid)
                        if (p && narration === 'Being payment') {
                          setNarration(`Being payment to ${p.name}`)
                        }
                      }
                    }}
                    storageKey={defaultPartyType}
                    placeholder={`Search ${defaultPartyType.toLowerCase()}… (optional)`}
                  />
                </div>
              </div>
            </Field>
          </div>
        </div>
      </Card>

      <Card className="overflow-hidden p-0">
        <div className="px-5 py-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--line)' }}>
          <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>Debit lines</h2>
          <div className="flex items-center gap-3 text-xs" style={{ color: 'var(--ink-2)' }}>
            <span>Sum of debits is credited to {bankCashAccount?.account_name || 'Bank/Cash'}</span>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b" style={{ background: 'var(--surface-1)', borderColor: 'var(--line)' }}>
              <tr>
                <th className="text-left text-[10px] font-semibold px-2 py-2 uppercase tracking-wide" style={{ color: 'var(--ink-2)' }}>Party</th>
                <th className="text-left text-[10px] font-semibold px-2 py-2 uppercase tracking-wide" style={{ color: 'var(--ink-2)' }}>Ledger (Dr)</th>
                <th className="text-left text-[10px] font-semibold px-2 py-2 uppercase tracking-wide" style={{ color: 'var(--ink-2)' }}>Reference</th>
                <th className="text-left text-[10px] font-semibold px-2 py-2 uppercase tracking-wide" style={{ color: 'var(--ink-2)' }}>Narration</th>
                <th className="text-right text-[10px] font-semibold px-2 py-2 uppercase tracking-wide" style={{ color: 'var(--ink-2)' }}>Amount</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <PaymentRowEditor
                  key={row.uid}
                  row={row}
                  accounts={rowAccounts}
                  suppliers={suppliers}
                  customers={customers}
                  onChange={(p) => patchRow(row.uid, p)}
                  onRemove={() => removeRow(row.uid)}
                  onAltC={handleAltCFromRow}
                  removeDisabled={rows.length <= 1}
                />
              ))}
            </tbody>
            <tfoot className="border-t" style={{ background: 'var(--surface-1)', borderColor: 'var(--line)' }}>
              <tr>
                <td className="px-2 py-2" colSpan={3}>
                  <button
                    type="button"
                    onClick={addRow}
                    className="inline-flex items-center gap-1.5 text-sm hover:opacity-90"
                    style={{ color: 'var(--brand)' }}
                  >
                    <Plus size={14} /> Add line
                  </button>
                </td>
                <td className="px-2 py-2 text-right text-xs" style={{ color: 'var(--ink-2)' }}>
                  Total Debit
                </td>
                <td className="px-2 py-2 text-right">
                  <span className="font-mono text-sm font-semibold" style={{ color: 'var(--ink)' }}>
                    {formatCurrency(total)}
                  </span>
                </td>
                <td />
              </tr>
              <tr>
                <td colSpan={6} className="px-4 py-1.5 text-right text-xs" style={{ color: 'var(--ink-3)' }}>
                  = Cr {bankCashAccount
                    ? `${bankCashAccount.account_code} ${bankCashAccount.account_name}`
                    : 'Bank/Cash (select above)'} · {formatCurrency(total)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      <Card className="p-4">
        <Field label="Narration" hint="Shown in Day Book and reports">
          <textarea
            value={narration}
            onChange={(e) => setNarration(e.target.value)}
            rows={2}
            className="w-full px-3 py-2 text-sm border rounded-lg outline-none focus:shadow-[0_0_0_3px_rgba(15,157,154,0.18)]"
            style={{ backgroundColor: 'var(--surface-0)', borderColor: 'var(--line)', color: 'var(--ink)' }}
          />
        </Field>
      </Card>

      <div
        className="fixed left-0 right-0 z-20 px-6 py-3 flex items-center justify-end gap-2"
        style={{
          bottom: 36,
          background: 'var(--surface-0)',
          borderTop: '1px solid var(--line)',
          boxShadow: '0 -4px 12px rgba(0,0,0,0.04)',
        }}
      >
        <Button variant="ghost" onClick={handleRepeatLast} disabled={!!editingId}>
          <History size={14} /> <span className="hidden sm:inline">Repeat Last</span>
          <kbd className="hidden md:inline mono text-[10px] ml-1" style={{ color: 'var(--ink-3)' }}>Ctrl+H</kbd>
        </Button>
        <Button variant="secondary" onClick={handleEsc}>
          Cancel <kbd className="hidden md:inline mono text-[10px] ml-1" style={{ color: 'var(--ink-3)' }}>Esc</kbd>
        </Button>
        <Button variant="secondary" onClick={() => handleSave(false)} disabled={saving || posting || allStores}>
          {saving && !posting ? <Loader2 className="animate-spin" size={14} /> : <Save size={14} />}
          Save Draft
        </Button>
        <Button onClick={() => handleSave(true)} disabled={saving || posting || !isValid || allStores}>
          {posting ? <Loader2 className="animate-spin" size={14} /> : <Send size={14} />}
          Save &amp; Post
          <kbd className="hidden md:inline mono text-[10px] ml-1 text-white/80">Ctrl+A</kbd>
        </Button>
      </div>

      <ConfirmDialog
        open={escConfirmOpen}
        onOpenChange={setEscConfirmOpen}
        title="Discard this voucher?"
        description="Any unsaved changes will be lost."
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        tone="danger"
        onConfirm={() => {
          setEscConfirmOpen(false)
          navigate('/')
        }}
      />

      <CreateLedgerModal
        open={createLedgerOpen}
        onOpenChange={setCreateLedgerOpen}
        parents={accounts}
        onCreated={handleLedgerCreated}
      />

      <CostCenterPopup
        open={costCenterOpen}
        onOpenChange={setCostCenterOpen}
        currentId={costCentreId}
        currentLabel={costCenter}
        onPick={({ id, label }) => {
          setCostCentreId(id)
          setCostCenter(label)
        }}
      />
    </div>
  )
}

function ModeBtn({ icon, label, active, onClick }: {
  icon?: React.ReactNode
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="px-2 py-1.5 text-xs font-semibold transition-colors inline-flex items-center gap-1"
      style={active
        ? { background: 'var(--brand)', color: '#fff' }
        : { background: 'transparent', color: 'var(--ink-2)' }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.backgroundColor = 'var(--color-hover-bg)'
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.backgroundColor = 'transparent'
      }}
    >
      {icon} {label}
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
