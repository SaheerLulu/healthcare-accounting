import { useState } from 'react'
import { toast } from 'sonner'
import {
  postInventoryAdjustment, postDrugExpiry,
  postStockTransfer, postBadDebtsProvision,
} from '../../lib/api'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Card } from '../../components/ui/card'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../../components/ui/tabs'

/**
 * Closing entries wizard — four specialised period-end JV forms in one page.
 * Each tab is a small standalone form that POSTs to its corresponding
 * journals endpoint and surfaces the result. Opening stock is no longer
 * a manual entry here — sync auto-posts it from the inventory side.
 */
export default function ClosingEntriesPage() {
  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-semibold" style={{ color: 'var(--ink)', letterSpacing: '-0.01em' }}>
          Closing & Period-End Entries
        </h1>
        <p className="text-sm mt-0.5" style={{ color: 'var(--ink-2)' }}>
          Specialised JVs for inventory, expiry, transfers, and provisions.
        </p>
      </div>

      <Tabs defaultValue="inventory-adj">
        <TabsList>
          <TabsTrigger value="inventory-adj">Shrinkage / Damage</TabsTrigger>
          <TabsTrigger value="drug-expiry">Drug Expiry</TabsTrigger>
          <TabsTrigger value="stock-transfer">Stock Transfer</TabsTrigger>
          <TabsTrigger value="bad-debts">Bad Debts Provision</TabsTrigger>
        </TabsList>

        <TabsContent value="inventory-adj"><InventoryAdjustmentForm /></TabsContent>
        <TabsContent value="drug-expiry"><DrugExpiryForm /></TabsContent>
        <TabsContent value="stock-transfer"><StockTransferForm /></TabsContent>
        <TabsContent value="bad-debts"><BadDebtsForm /></TabsContent>
      </Tabs>
    </div>
  )
}

function InventoryAdjustmentForm() {
  const [data, setData] = useState({
    date: new Date().toISOString().slice(0, 10),
    location_id: '', value: '', adjustment_type: 'shrinkage' as const,
    itc_to_reverse: '0', narration: '',
  })
  return (
    <Card className="p-5 space-y-3">
      <p className="text-sm" style={{ color: 'var(--ink-2)' }}>
        Books <strong>Dr Inventory Loss + ITC reversal / Cr Closing Stock + Input GST</strong> per CGST §17(5)(h).
      </p>
      <Input type="date" value={data.date} onChange={(e) => setData({ ...data, date: e.target.value })} />
      <Input placeholder="Location ID" value={data.location_id}
             onChange={(e) => setData({ ...data, location_id: e.target.value })} />
      <Input placeholder="Value ₹" value={data.value}
             onChange={(e) => setData({ ...data, value: e.target.value })} />
      <select className="border rounded px-2 py-1.5 w-full" value={data.adjustment_type}
              onChange={(e) => setData({ ...data, adjustment_type: e.target.value as any })}>
        <option value="shrinkage">Shrinkage</option>
        <option value="damage">Damage</option>
        <option value="count_variance">Count Variance</option>
      </select>
      <Input placeholder="ITC to reverse ₹ (split CGST/SGST 50:50)" value={data.itc_to_reverse}
             onChange={(e) => setData({ ...data, itc_to_reverse: e.target.value })} />
      <Input placeholder="Narration" value={data.narration}
             onChange={(e) => setData({ ...data, narration: e.target.value })} />
      <Button onClick={async () => {
        try {
          const r = await postInventoryAdjustment({
            ...data, location_id: parseInt(data.location_id),
          })
          toast.success(`Posted ${r.entry_no}`)
        } catch (e: any) { toast.error(e?.response?.data?.detail || 'Failed') }
      }}>Post Adjustment</Button>
    </Card>
  )
}

function DrugExpiryForm() {
  const [data, setData] = useState({
    date: new Date().toISOString().slice(0, 10),
    location_id: '', value_at_cost: '', itc_to_reverse: '0', narration: '',
  })
  return (
    <Card className="p-5 space-y-3">
      <p className="text-sm" style={{ color: 'var(--ink-2)' }}>
        Pharmacy-specific: <strong>Dr Expiry Loss + ITC reversal / Cr Closing Stock + Input GST</strong>.
      </p>
      <Input type="date" value={data.date} onChange={(e) => setData({ ...data, date: e.target.value })} />
      <Input placeholder="Location ID" value={data.location_id}
             onChange={(e) => setData({ ...data, location_id: e.target.value })} />
      <Input placeholder="Value at cost ₹" value={data.value_at_cost}
             onChange={(e) => setData({ ...data, value_at_cost: e.target.value })} />
      <Input placeholder="ITC to reverse ₹" value={data.itc_to_reverse}
             onChange={(e) => setData({ ...data, itc_to_reverse: e.target.value })} />
      <Input placeholder="Narration" value={data.narration}
             onChange={(e) => setData({ ...data, narration: e.target.value })} />
      <Button onClick={async () => {
        try {
          const r = await postDrugExpiry({ ...data, location_id: parseInt(data.location_id) })
          toast.success(`Posted ${r.entry_no}`)
        } catch (e: any) { toast.error(e?.response?.data?.detail || 'Failed') }
      }}>Post Write-off</Button>
    </Card>
  )
}

function StockTransferForm() {
  const [data, setData] = useState({
    date: new Date().toISOString().slice(0, 10),
    value: '', from_location_id: '', to_location_id: '', narration: '',
  })
  return (
    <Card className="p-5 space-y-3">
      <p className="text-sm" style={{ color: 'var(--ink-2)' }}>
        Posts a pair of JVs using the <strong>Stock-In-Transit</strong> account that nets to zero across the pair.
      </p>
      <Input type="date" value={data.date} onChange={(e) => setData({ ...data, date: e.target.value })} />
      <Input placeholder="From location ID" value={data.from_location_id}
             onChange={(e) => setData({ ...data, from_location_id: e.target.value })} />
      <Input placeholder="To location ID" value={data.to_location_id}
             onChange={(e) => setData({ ...data, to_location_id: e.target.value })} />
      <Input placeholder="Value at cost ₹" value={data.value}
             onChange={(e) => setData({ ...data, value: e.target.value })} />
      <Input placeholder="Narration" value={data.narration}
             onChange={(e) => setData({ ...data, narration: e.target.value })} />
      <Button onClick={async () => {
        try {
          const r = await postStockTransfer({
            ...data,
            from_location_id: parseInt(data.from_location_id),
            to_location_id: parseInt(data.to_location_id),
          })
          toast.success(`Posted ${r.out_entry.entry_no} ↔ ${r.in_entry.entry_no}`)
        } catch (e: any) { toast.error(e?.response?.data?.detail || 'Failed') }
      }}>Post Transfer</Button>
    </Card>
  )
}

function BadDebtsForm() {
  const [data, setData] = useState({
    as_of: new Date().toISOString().slice(0, 10),
    location_id: '', narration: '',
  })
  const [result, setResult] = useState<any>(null)
  return (
    <Card className="p-5 space-y-3">
      <p className="text-sm" style={{ color: 'var(--ink-2)' }}>
        Aging-based provision (0/25/50/100% buckets). Posts only the delta against existing provision balance.
      </p>
      <Input type="date" value={data.as_of} onChange={(e) => setData({ ...data, as_of: e.target.value })} />
      <Input placeholder="Location ID (optional)" value={data.location_id}
             onChange={(e) => setData({ ...data, location_id: e.target.value })} />
      <Input placeholder="Narration" value={data.narration}
             onChange={(e) => setData({ ...data, narration: e.target.value })} />
      <Button onClick={async () => {
        try {
          const r = await postBadDebtsProvision({
            ...data, location_id: data.location_id ? parseInt(data.location_id) : undefined,
          })
          setResult(r)
          if (r.journal_entry) toast.success(`Posted ${r.journal_entry.entry_no}`)
          else toast.success('No adjustment needed')
        } catch (e: any) { toast.error(e?.response?.data?.detail || 'Failed') }
      }}>Compute & Post</Button>
      {result && (
        <Card className="p-3 mt-3 text-sm">
          <div>Required: ₹{result.required_provision}</div>
          <div>Existing: ₹{result.existing_provision}</div>
          <div>Adjustment: ₹{result.adjustment}</div>
        </Card>
      )}
    </Card>
  )
}
