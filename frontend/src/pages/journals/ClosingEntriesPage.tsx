import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import {
  postInventoryAdjustment, postDrugExpiry,
  postStockTransfer, postBadDebtsProvision,
} from '../../lib/api'
import { useLocation } from '../../contexts/LocationContext'
import { usePageKeyboard } from '../../hooks/usePageKeyboard'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Card } from '../../components/ui/card'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../../components/ui/tabs'

/**
 * Closing entries wizard — four specialised period-end JV forms in one page.
 * Each tab is a small standalone form that POSTs to its corresponding
 * journals endpoint and surfaces the result. Opening stock is no longer
 * a manual entry here — sync auto-posts it from the inventory side.
 *
 * Location is taken from the active-store context (the location switcher in
 * the layout), never typed in by hand — see [[active-location]].
 */

type TabKey = 'inventory-adj' | 'drug-expiry' | 'stock-transfer' | 'bad-debts'

const POST_LABEL: Record<TabKey, string> = {
  'inventory-adj': 'Post adjustment',
  'drug-expiry': 'Post write-off',
  'stock-transfer': 'Post transfer',
  'bad-debts': 'Compute & post',
}

export default function ClosingEntriesPage() {
  const navigate = useNavigate()
  const [tab, setTab] = useState<TabKey>('inventory-adj')
  // Only the active tab's panel is mounted, so "the form in here" is
  // unambiguous — the chord posts whichever tab the user is looking at.
  const panelRef = useRef<HTMLDivElement>(null)

  function postActiveTab() {
    const form = panelRef.current?.querySelector('form')
    if (!form) return
    // requestSubmit runs the same path as the button (validation included);
    // the dispatch is the fallback for Safari < 16, which lacks it.
    if (typeof form.requestSubmit === 'function') form.requestSubmit()
    else form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  }

  usePageKeyboard({
    actions: [
      { chord: 'Ctrl+A', label: POST_LABEL[tab], run: postActiveTab },
      // The same action under the chord ShortcutHelp advertises app-wide as
      // "save and post"; hidden so the bar shows one row, not two.
      { chord: 'Ctrl+Enter', label: POST_LABEL[tab], run: postActiveTab, hidden: true },
    ],
    onBack: () => navigate(-1),
  })

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div>
        <h1 className="text-lg sm:text-xl font-semibold" style={{ color: 'var(--ink)', letterSpacing: '-0.01em' }}>
          Closing & Period-End Entries
        </h1>
        <p className="text-sm mt-0.5" style={{ color: 'var(--ink-2)' }}>
          Specialised JVs for inventory, expiry, transfers, and provisions.
        </p>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
        <TabsList>
          <TabsTrigger value="inventory-adj">Shrinkage / Damage</TabsTrigger>
          <TabsTrigger value="drug-expiry">Drug Expiry</TabsTrigger>
          <TabsTrigger value="stock-transfer">Stock Transfer</TabsTrigger>
          <TabsTrigger value="bad-debts">Bad Debts Provision</TabsTrigger>
        </TabsList>

        <div ref={panelRef}>
          <TabsContent value="inventory-adj"><InventoryAdjustmentForm /></TabsContent>
          <TabsContent value="drug-expiry"><DrugExpiryForm /></TabsContent>
          <TabsContent value="stock-transfer"><StockTransferForm /></TabsContent>
          <TabsContent value="bad-debts"><BadDebtsForm /></TabsContent>
        </div>
      </Tabs>
    </div>
  )
}

/** Small read-only banner showing which store the JV will post to. */
function ActiveStoreNote({ name }: { name: string | null }) {
  return (
    <p className="text-xs" style={{ color: 'var(--ink-2)' }}>
      Posting to: <strong>{name || 'Select a store from the switcher above'}</strong>
    </p>
  )
}

function InventoryAdjustmentForm() {
  const { activeLocationId, activeLocation } = useLocation()
  const [busy, setBusy] = useState(false)
  const [data, setData] = useState({
    date: new Date().toISOString().slice(0, 10),
    value: '', adjustment_type: 'shrinkage' as const,
    itc_to_reverse: '0', narration: '',
  })

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    if (!activeLocationId) { toast.error('Select a store first'); return }
    setBusy(true)
    try {
      const r = await postInventoryAdjustment({
        ...data, location_id: activeLocationId,
      })
      toast.success(`Posted ${r.entry_no}`)
    } catch (e: any) { toast.error(e?.response?.data?.detail || 'Failed') }
    finally { setBusy(false) }
  }

  return (
    <Card className="p-4 sm:p-5">
      {/* A real <form>: Enter from any field posts, instead of making the user
          tab past every remaining control to reach the button. */}
      <form className="space-y-3" onSubmit={submit}>
        <p className="text-sm" style={{ color: 'var(--ink-2)' }}>
          Books <strong>Dr Inventory Loss + ITC reversal / Cr Closing Stock + Input GST</strong> per CGST §17(5)(h).
        </p>
        <ActiveStoreNote name={activeLocation?.name ?? null} />
        <Input type="date" aria-label="Adjustment date" data-autofocus
               value={data.date} onChange={(e) => setData({ ...data, date: e.target.value })} />
        <Input placeholder="Value ₹" aria-label="Value ₹" value={data.value}
               onChange={(e) => setData({ ...data, value: e.target.value })} />
        <select className="border rounded px-2 py-1.5 w-full" aria-label="Adjustment type"
                value={data.adjustment_type}
                onChange={(e) => setData({ ...data, adjustment_type: e.target.value as any })}>
          <option value="shrinkage">Shrinkage</option>
          <option value="damage">Damage</option>
          <option value="count_variance">Count Variance</option>
        </select>
        <Input placeholder="ITC to reverse ₹ (split CGST/SGST 50:50)" value={data.itc_to_reverse}
               aria-label="ITC to reverse ₹ (split CGST/SGST 50:50)"
               onChange={(e) => setData({ ...data, itc_to_reverse: e.target.value })} />
        <Input placeholder="Narration" aria-label="Narration" value={data.narration}
               onChange={(e) => setData({ ...data, narration: e.target.value })} />
        <Button type="submit" className="w-full sm:w-auto" chord="Ctrl+A" disabled={busy}>Post Adjustment</Button>
      </form>
    </Card>
  )
}

function DrugExpiryForm() {
  const { activeLocationId, activeLocation } = useLocation()
  const [busy, setBusy] = useState(false)
  const [data, setData] = useState({
    date: new Date().toISOString().slice(0, 10),
    value_at_cost: '', itc_to_reverse: '0', narration: '',
  })

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    if (!activeLocationId) { toast.error('Select a store first'); return }
    setBusy(true)
    try {
      const r = await postDrugExpiry({ ...data, location_id: activeLocationId })
      toast.success(`Posted ${r.entry_no}`)
    } catch (e: any) { toast.error(e?.response?.data?.detail || 'Failed') }
    finally { setBusy(false) }
  }

  return (
    <Card className="p-4 sm:p-5">
      <form className="space-y-3" onSubmit={submit}>
        <p className="text-sm" style={{ color: 'var(--ink-2)' }}>
          Pharmacy-specific: <strong>Dr Expiry Loss + ITC reversal / Cr Closing Stock + Input GST</strong>.
        </p>
        <ActiveStoreNote name={activeLocation?.name ?? null} />
        <Input type="date" aria-label="Write-off date" data-autofocus
               value={data.date} onChange={(e) => setData({ ...data, date: e.target.value })} />
        <Input placeholder="Value at cost ₹" aria-label="Value at cost ₹" value={data.value_at_cost}
               onChange={(e) => setData({ ...data, value_at_cost: e.target.value })} />
        <Input placeholder="ITC to reverse ₹" aria-label="ITC to reverse ₹" value={data.itc_to_reverse}
               onChange={(e) => setData({ ...data, itc_to_reverse: e.target.value })} />
        <Input placeholder="Narration" aria-label="Narration" value={data.narration}
               onChange={(e) => setData({ ...data, narration: e.target.value })} />
        <Button type="submit" className="w-full sm:w-auto" chord="Ctrl+A" disabled={busy}>Post Write-off</Button>
      </form>
    </Card>
  )
}

function StockTransferForm() {
  const { activeLocationId, activeLocation, locations } = useLocation()
  const [busy, setBusy] = useState(false)
  const [data, setData] = useState({
    date: new Date().toISOString().slice(0, 10),
    value: '', to_location_id: '', narration: '',
  })
  // "From" is always the active store; "To" is another of the user's stores.
  const destinations = locations.filter((l) => l.id !== activeLocationId)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    if (!activeLocationId) { toast.error('Select the source store first'); return }
    if (!data.to_location_id) { toast.error('Select a destination store'); return }
    setBusy(true)
    try {
      const r = await postStockTransfer({
        ...data,
        from_location_id: activeLocationId,
        to_location_id: parseInt(data.to_location_id),
      })
      toast.success(`Posted ${r.out_entry.entry_no} ↔ ${r.in_entry.entry_no}`)
    } catch (e: any) { toast.error(e?.response?.data?.detail || 'Failed') }
    finally { setBusy(false) }
  }

  return (
    <Card className="p-4 sm:p-5">
      <form className="space-y-3" onSubmit={submit}>
        <p className="text-sm" style={{ color: 'var(--ink-2)' }}>
          Posts a pair of JVs using the <strong>Stock-In-Transit</strong> account that nets to zero across the pair.
        </p>
        <ActiveStoreNote name={activeLocation?.name ?? null} />
        <Input type="date" aria-label="Transfer date" data-autofocus
               value={data.date} onChange={(e) => setData({ ...data, date: e.target.value })} />
        <label className="text-xs block" htmlFor="transfer-to-store" style={{ color: 'var(--ink-2)' }}>Transfer to store</label>
        <select id="transfer-to-store" className="border rounded px-2 py-1.5 w-full" value={data.to_location_id}
                onChange={(e) => setData({ ...data, to_location_id: e.target.value })}>
          <option value="">Select destination store…</option>
          {destinations.map((l) => (
            <option key={l.id} value={l.id}>{l.name}</option>
          ))}
        </select>
        <Input placeholder="Value at cost ₹" aria-label="Value at cost ₹" value={data.value}
               onChange={(e) => setData({ ...data, value: e.target.value })} />
        <Input placeholder="Narration" aria-label="Narration" value={data.narration}
               onChange={(e) => setData({ ...data, narration: e.target.value })} />
        <Button type="submit" className="w-full sm:w-auto" chord="Ctrl+A" disabled={busy}>Post Transfer</Button>
      </form>
    </Card>
  )
}

function BadDebtsForm() {
  const { activeLocationId, activeLocation } = useLocation()
  const [busy, setBusy] = useState(false)
  const [data, setData] = useState({
    as_of: new Date().toISOString().slice(0, 10),
    narration: '',
  })
  const [result, setResult] = useState<any>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    try {
      const r = await postBadDebtsProvision({
        ...data, location_id: activeLocationId ?? undefined,
      })
      setResult(r)
      if (r.journal_entry) toast.success(`Posted ${r.journal_entry.entry_no}`)
      else toast.success('No adjustment needed')
    } catch (e: any) { toast.error(e?.response?.data?.detail || 'Failed') }
    finally { setBusy(false) }
  }

  return (
    <Card className="p-4 sm:p-5">
      <form className="space-y-3" onSubmit={submit}>
        <p className="text-sm" style={{ color: 'var(--ink-2)' }}>
          Aging-based provision (0/25/50/100% buckets). Posts only the delta against existing provision balance.
        </p>
        <ActiveStoreNote name={activeLocation?.name ?? 'All stores'} />
        <Input type="date" aria-label="Provision as-of date" data-autofocus
               value={data.as_of} onChange={(e) => setData({ ...data, as_of: e.target.value })} />
        <Input placeholder="Narration" aria-label="Narration" value={data.narration}
               onChange={(e) => setData({ ...data, narration: e.target.value })} />
        <Button type="submit" className="w-full sm:w-auto" chord="Ctrl+A" disabled={busy}>Compute & Post</Button>
        {/* The computed figures appear below the button the user just pressed —
            a live region so they are announced rather than only drawn. */}
        {result && (
          <Card role="status" aria-live="polite" className="p-3 mt-3 text-sm">
            <div>Required: ₹{result.required_provision}</div>
            <div>Existing: ₹{result.existing_provision}</div>
            <div>Adjustment: ₹{result.adjustment}</div>
          </Card>
        )}
      </form>
    </Card>
  )
}
