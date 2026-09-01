import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2, Wallet, ExternalLink } from 'lucide-react'
import { toast } from 'sonner'
import {
  getOpenCustomerInvoices, createReceiptVoucher,
  type OpenCustomerInvoice,
} from '../lib/api'
import { formatCurrency, formatDate, todayISO, cn } from '../lib/utils'
import { Input } from '../components/ui/input'
import { Card } from '../components/ui/card'
import { Table, Thead, Tbody, Tr, Th, Td } from '../components/ui/table'
import { Button } from '../components/ui/button'
import { EmptyState } from '../components/ui/EmptyState'
import { SkeletonTable } from '../components/ui/Skeletons'
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetBody, SheetFooter, SheetClose,
} from '../components/ui/sheet'
import { useLocation as useActiveLocation } from '../contexts/LocationContext'
import { usePageKeyboard } from '../hooks/usePageKeyboard'
import { useListKeyboardNav } from '../hooks/useListKeyboardNav'

/** Why Receive is unavailable on a walk-in row — shown, announced, and toasted. */
const UNTAGGED_REASON =
  'Untagged balance — assign this sale to a customer before recording a receipt'

/**
 * Enter/Space on a control inside a row has already done its job; letting the
 * key bubble on to the row's own activate handler would fire twice from one
 * press (follow the customer link AND open the receipt sheet). Arrow keys are
 * left alone so the row nav still works from a nested control.
 */
function rowKeys(handler: (e: React.KeyboardEvent) => void) {
  return (e: React.KeyboardEvent) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target !== e.currentTarget) {
      if ((e.target as HTMLElement).closest('button, a')) return
    }
    handler(e)
  }
}

/**
 * Receivables — one row per open customer SALE invoice. Click Receive on
 * any row to record a receipt against that customer. Per-invoice balance
 * isn't tracked (no bill-allocation on the customer side); the rightmost
 * "Customer outstanding" column shows the customer's running net so you
 * can see which customers still owe overall.
 */
export default function ReceivablesPage() {
  const [rows, setRows] = useState<OpenCustomerInvoice[]>([])
  const [loading, setLoading] = useState(true)
  // Local calendar date. toISOString() is UTC, which in IST is YESTERDAY until
  // 05:30 — an early-morning open would silently hide invoices dated today.
  const [asOf, setAsOf] = useState(todayISO())
  const [search, setSearch] = useState('')
  const [receiving, setReceiving] = useState<OpenCustomerInvoice | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  // The receipt sheet lives in a child component; the page holds a handle on
  // its <form> so one Ctrl+S registration can post it without a second
  // usePageKeyboard call fighting this one for the hint bar.
  const receiveFormRef = useRef<HTMLFormElement>(null)

  async function load() {
    setLoading(true)
    try {
      const params: Record<string, string> = {}
      if (asOf) params.date = asOf
      if (search) params.search = search
      const res = await getOpenCustomerInvoices(params)
      setRows(res.rows)
    } catch {
      toast.error('Failed to load open customer invoices')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() /* eslint-disable-next-line */ }, [asOf])
  useEffect(() => {
    const t = setTimeout(load, 250)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  // Each row now carries its own remaining balance, so the total is a plain
  // sum. It used to read customer_outstanding — the party's whole balance —
  // once per party, because per-invoice figures did not net part-receipts.
  const totals = useMemo(() => {
    const customers = new Set<number>()
    let sum = 0
    let untagged = 0
    for (const r of rows) {
      // An untagged row is a receivable posted without a party (walk-in counter
      // sales). It belongs in the total — it IS money owed — but it is not a
      // customer, so counting it as one would inflate the customer count.
      if (r.party_id == null) untagged += 1
      else customers.add(r.party_id)
      sum += parseFloat(r.outstanding_amount ?? r.amount ?? '0') || 0
    }
    return {
      invoiceCount: rows.length,
      customerCount: customers.size,
      untaggedCount: untagged,
      totalOutstanding: sum,
    }
  }, [rows])

  // ─── Keyboard ──────────────────────────────────────────────────────────────
  // Rows carry the only route to a receipt, so give them a roving tabindex:
  // one tab stop for the register, ↑↓ to move, Enter to open the sheet on the
  // highlighted invoice. An untagged (walk-in) row can't take a receipt, so
  // Enter there says why instead of silently doing nothing.
  const list = useListKeyboardNav({
    count: rows.length,
    onActivate: (i) => {
      const r = rows[i]
      if (!r) return
      if (r.party_id == null) {
        toast.error(UNTAGGED_REASON)
        return
      }
      setReceiving(r)
    },
  })

  const hasFilters = !!search || asOf !== todayISO()

  usePageKeyboard({
    actions: [
      { chord: 'Alt+R', label: 'Refresh', run: load, when: !receiving },
      {
        chord: 'Alt+C',
        label: 'Clear filters',
        run: () => { setSearch(''); setAsOf(todayISO()) },
        when: hasFilters && !receiving,
      },
      {
        chord: 'Ctrl+S',
        label: 'Post receipt',
        run: () => receiveFormRef.current?.requestSubmit(),
        when: !!receiving,
      },
    ],
    searchRef,
    onFocusList: list.focusList,
  })

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-lg sm:text-xl font-semibold" style={{ color: 'var(--ink)', letterSpacing: '-0.01em' }}>
            Receivables
          </h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--ink-2)' }}>
            <span className="mono">{totals.invoiceCount}</span> open invoice
            {totals.invoiceCount === 1 ? '' : 's'} across <span className="mono">{totals.customerCount}</span>{' '}
            customer{totals.customerCount === 1 ? '' : 's'}, owing{' '}
            <span className="font-medium mono" style={{ color: 'var(--warning)' }}>
              {formatCurrency(totals.totalOutstanding)}
            </span>
            {totals.untaggedCount > 0 && (
              <>
                {' '}(including <span className="mono">{totals.untaggedCount}</span> untagged
                {' '}walk-in{totals.untaggedCount === 1 ? '' : 's'})
              </>
            )}
            . Click Receive on an invoice to record a payment from that customer.
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap w-full sm:w-auto">
          <Input
            ref={searchRef}
            type="text"
            placeholder="Search invoice # or customer… (F2)"
            aria-label="Search open invoices by number or customer"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full sm:w-56"
          />
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <label className="text-xs font-medium mono uppercase" style={{ color: 'var(--ink-2)', letterSpacing: '0.08em' }}>As of</label>
            <Input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)}
              aria-label="Show invoices open as of this date" className="w-full sm:w-auto" />
          </div>
        </div>
      </div>

      {loading ? (
        <SkeletonTable rows={6} cols={8} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Wallet}
          title="No outstanding customer invoices"
          description="When customers owe you money, their open invoices will appear here."
        />
      ) : (
        <Card className="overflow-hidden p-0">
          <Table>
            <Thead>
              <Tr>
                <Th className="text-left">Invoice #</Th>
                <Th className="text-left">Date</Th>
                <Th className="text-left">Due</Th>
                <Th className="text-left">Type</Th>
                <Th className="text-left">Customer</Th>
                <Th className="text-right px-3">Invoice Amount</Th>
                <Th className="text-right px-3">Outstanding</Th>
                <Th className="w-[140px]" />
              </Tr>
            </Thead>
            <Tbody {...list.containerProps}>
              {rows.map((r, i) => {
                const untagged = r.party_id == null
                const rp = list.rowProps(i)
                // Overdue against the AS-OF date the toolbar is showing, not
                // the wall clock — an as-of in the past must not brand an
                // invoice overdue on the strength of days it hadn't yet lived.
                const overdue = !!r.due_date && r.due_date < asOf
                return (
                  // The index keeps the key unique: untagged rows all collapse
                  // to the same "null-…" prefix, and two of them can share an
                  // invoice number (JV-… for a day's counter sales).
                  <Tr
                    key={`${r.party_id ?? 'untagged'}-${r.invoice_no}-${i}`}
                    className="group"
                    aria-label={`Invoice ${r.invoice_no} · ${r.party_name || 'Untagged'}`}
                    aria-describedby={untagged ? `untagged-${i}` : undefined}
                    {...rp}
                    onKeyDown={rowKeys(rp.onKeyDown)}
                  >
                    <Td>
                      <span className="font-medium mono" style={{ color: 'var(--brand)' }}>
                        {r.invoice_no}
                      </span>
                    </Td>
                    <Td className="text-sm" style={{ color: 'var(--ink-2)' }}>{formatDate(r.date)}</Td>
                    {/* Invoice date + the customer's credit days. An em dash
                        means no terms on file, not "no deadline". */}
                    <Td className={cn('text-sm', overdue && 'font-medium')}
                      style={{ color: overdue ? 'var(--danger)' : 'var(--ink-2)' }}
                      title={r.credit_days != null ? `${r.credit_days} credit days` : 'No credit terms on file'}>
                      {r.due_date ? formatDate(r.due_date) : '—'}
                      {overdue && <span className="ml-1 text-xs">(overdue)</span>}
                    </Td>
                    <Td className="text-xs" style={{ color: 'var(--ink-2)' }}>{r.voucher_type}</Td>
                    <Td className="font-medium">
                      {untagged ? (
                        // No party record to open — this balance sits on the
                        // control account itself.
                        <span style={{ color: 'var(--ink-2)' }}>
                          {r.party_name || 'Untagged'}
                        </span>
                      ) : (
                        <Link
                          to={`/parties/customers/${r.party_id}`}
                          className="inline-flex items-center gap-1 hover:underline"
                          style={{ color: 'var(--ink)' }}
                        >
                          {r.party_name}
                          <ExternalLink size={11} className="opacity-100 lg:opacity-0 lg:group-hover:opacity-100 lg:group-focus-within:opacity-100" style={{ color: 'var(--brand)' }} />
                        </Link>
                      )}
                    </Td>
                    <Td className="text-right mono px-3" style={{ color: 'var(--ink)' }}>
                      {formatCurrency(r.amount)}
                    </Td>
                    <Td className="text-right mono font-semibold px-3"
                      style={{ color: 'var(--warning)' }}>
                      {formatCurrency(r.outstanding_amount ?? r.amount)}
                    </Td>
                    <Td className="text-right pr-3">
                      {/* Title sits on the wrapper because a disabled Button
                          carries pointer-events-none and never gets a hover. */}
                      <div
                        className="flex items-center justify-end gap-1.5 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 lg:group-focus-within:opacity-100 transition-opacity"
                        title={untagged ? UNTAGGED_REASON : undefined}
                      >
                        {/* A `title` is pointer-only and the disabled button
                            can't be focused, so a keyboard user got no signal
                            at all. The reason is now announced with the row
                            (aria-describedby) and toasted on Enter. */}
                        {untagged && (
                          <span id={`untagged-${i}`} className="sr-only">{UNTAGGED_REASON}</span>
                        )}
                        {/* Disabled without a party, and not merely for tidiness:
                            the receipt endpoint takes party_id as optional and
                            gates its over-receipt check on `if party_id`, so a
                            receipt posted from this row would skip the AR guard
                            entirely and could be banked for more than is owed.
                            The credit itself does now net this row down — every
                            id-less posting on the control shares one pile — but
                            an unguarded receipt is still the wrong way in. Tag
                            the sale to a customer first. */}
                        <Button
                          size="sm"
                          disabled={untagged}
                          onClick={() => setReceiving(r)}
                          aria-label={`Receive against ${r.invoice_no}`}
                        >
                          <Wallet size={13} /> Receive
                        </Button>
                      </div>
                    </Td>
                  </Tr>
                )
              })}
            </Tbody>
            <tfoot>
              <tr style={{ borderTop: '2px solid var(--line)', background: 'var(--color-grey-light)' }} className="font-semibold">
                <td colSpan={5} className="py-3 px-4 text-sm" style={{ color: 'var(--ink-2)' }}>
                  Total · {totals.customerCount} customer{totals.customerCount === 1 ? '' : 's'}
                  {totals.untaggedCount > 0 && ` + ${totals.untaggedCount} untagged`}
                </td>
                <td className="py-3 px-3 text-right mono" style={{ color: 'var(--warning)' }}>
                  {formatCurrency(totals.totalOutstanding)}
                </td>
                <td />
              </tr>
            </tfoot>
          </Table>
        </Card>
      )}

      {receiving && (
        <ReceivePaymentSheet
          row={receiving}
          formRef={receiveFormRef}
          onClose={() => setReceiving(null)}
          onSuccess={() => { setReceiving(null); load() }}
        />
      )}
    </div>
  )
}

function ReceivePaymentSheet({ row, formRef, onClose, onSuccess }: {
  row: OpenCustomerInvoice
  formRef: React.RefObject<HTMLFormElement>
  onClose: () => void
  onSuccess: () => void
}) {
  const [date, setDate] = useState(todayISO())
  const [amount, setAmount] = useState(row.amount)
  const [mode, setMode] = useState<'bank' | 'cash'>('bank')
  const [narration, setNarration] = useState(`Receipt from ${row.party_name} (${row.invoice_no})`)
  const [saving, setSaving] = useState(false)
  const { activeLocationId } = useActiveLocation()

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const amt = parseFloat(amount) || 0
    if (amt <= 0) { toast.error('Amount must be > 0'); return }
    // Belt-and-braces behind the disabled Receive button: an untagged row has
    // no party to credit, and posting without one skips the server's AR
    // over-receipt check instead of clearing the balance.
    if (row.party_id == null) {
      toast.error('This balance is not tagged to a customer — tag the sale before receiving against it')
      return
    }
    if (activeLocationId === null) {
      toast.error('Select a specific location before recording a receipt')
      return
    }
    setSaving(true)
    try {
      await createReceiptVoucher({
        date, amount, party_id: row.party_id,
        receipt_mode: mode, narration,
        location_id: activeLocationId,
      })
      toast.success(`Receipt against ${row.invoice_no} posted`)
      onSuccess()
    } catch (err) {
      const e = err as { response?: { data?: { detail?: string } } }
      toast.error(e.response?.data?.detail || 'Failed to post receipt')
    } finally { setSaving(false) }
  }

  return (
    <Sheet open onOpenChange={(o) => { if (!o) onClose() }}>
      <SheetContent width="md">
        <form ref={formRef} onSubmit={submit} className="flex flex-col h-full">
          <SheetHeader>
            <SheetTitle>Receive against {row.invoice_no}</SheetTitle>
            <p className="text-xs mt-0.5" style={{ color: 'var(--ink-3)' }}>
              From <span className="font-medium">{row.party_name}</span> · Invoice{' '}
              <span className="font-mono">{formatCurrency(row.amount)}</span> · Customer outstanding{' '}
              <span className="font-mono font-medium">{formatCurrency((row.customer_outstanding ?? '0'))}</span>
            </p>
          </SheetHeader>
          <SheetBody>
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Date" required>
                  <Input type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
                </Field>
                <Field label="Amount" required>
                  {/* The sheet's entry field: SheetContent focuses (and, being
                      numeric, Input selects) this on open, so the prefilled
                      amount can be typed over and Enter posts it — the first
                      Enter used to hit the header's close X. */}
                  <Input data-autofocus type="number" step="0.01" min="0.01" required value={amount}
                    onChange={(e) => setAmount(e.target.value)} className="text-right font-mono" />
                </Field>
              </div>
              <Field label="Received in">
                {/* `hidden` is display:none, which took the radios out of the
                    tab order and the a11y tree entirely — every keyboard-posted
                    receipt was therefore a BANK receipt. `sr-only` keeps them
                    focusable, so the pair behaves as the native radio group it
                    is (Tab in, ←/→ to switch), and focus-within paints the
                    label the focus ring would otherwise be invisible on. */}
                <div className="flex gap-2" role="radiogroup" aria-label="Received in">
                  {(['bank', 'cash'] as const).map((m) => (
                    <label key={m} className={cn(
                      'flex-1 flex items-center justify-center px-3 py-2 rounded-lg border cursor-pointer text-sm capitalize',
                      'focus-within:shadow-[0_0_0_3px_rgba(15,157,154,0.18)]',
                      mode === m ? 'border-teal-500 bg-teal-50 text-teal-700' : 'border-slate-200 text-slate-600'
                    )}>
                      <input
                        type="radio"
                        name="receipt-mode"
                        value={m}
                        checked={mode === m}
                        onChange={() => setMode(m)}
                        className="sr-only"
                      />
                      {m}
                    </label>
                  ))}
                </div>
              </Field>
              <Field label="Narration">
                <Input value={narration} onChange={(e) => setNarration(e.target.value)} />
              </Field>
              <div
                className="text-xs rounded-lg p-3"
                style={{
                  background: 'var(--surface-1)',
                  color: 'var(--ink-3)',
                  border: '1px solid var(--line)',
                }}
              >
                Posts a Receipt at the customer level: Dr {mode === 'bank' ? 'Bank' : 'Cash'} /
                Cr Trade Receivables (party-tagged to {row.party_name}). Customer-side payments
                aren't allocated to specific invoices, so the receipt reduces the customer's
                overall outstanding balance.
              </div>
            </div>
          </SheetBody>
          <SheetFooter>
            <SheetClose asChild><Button type="button" variant="secondary">Cancel</Button></SheetClose>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="animate-spin" size={14} />} Post Receipt
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}

function Field({ label, required, children }: {
  label: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="block text-xs font-medium mb-1.5" style={{ color: 'var(--ink-2)' }}>
        {label} {required && <span style={{ color: 'var(--danger)' }}>*</span>}
      </span>
      {children}
    </label>
  )
}
