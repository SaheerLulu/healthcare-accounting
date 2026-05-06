import { useEffect, useState } from 'react'
import { Plus, ArrowDown, ArrowUp, Eye } from 'lucide-react'
import { toast } from 'sonner'
import {
  listPettyCashFloats, createPettyCashFloat,
  spendPettyCash, replenishPettyCash, getPettyCashTxns,
  type PettyCashFloat, type PettyCashTxn,
} from '../../lib/api'
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

export default function PettyCashPage() {
  const [floats, setFloats] = useState<PettyCashFloat[]>([])
  const [loading, setLoading] = useState(true)
  const [showDialog, setShowDialog] = useState(false)
  const [spendFor, setSpendFor] = useState<PettyCashFloat | null>(null)
  const [replenishFor, setReplenishFor] = useState<PettyCashFloat | null>(null)
  const [txnsFor, setTxnsFor] = useState<PettyCashFloat | null>(null)

  async function load() {
    setLoading(true)
    try {
      const r = await listPettyCashFloats()
      setFloats(Array.isArray(r) ? r : (r.results ?? []))
    } catch { toast.error('Failed to load floats') }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--ink)', letterSpacing: '-0.01em' }}>Petty Cash</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--ink-2)' }}>
            <span className="mono">{floats.length}</span> petty-cash floats across locations
          </p>
        </div>
        <Button onClick={() => setShowDialog(true)}><Plus size={16} /> New Float</Button>
      </div>

      {loading ? <SkeletonTable /> : floats.length === 0 ? (
        <EmptyState title="No petty cash floats" description="Set up a per-location float to start recording small cash spends." />
      ) : (
        <Card>
          <Table>
            <Thead>
              <Tr><Th>Location</Th><Th>Custodian</Th><Th>GL</Th>
                <Th className="text-right">Imprest</Th><Th className="text-right">Threshold</Th>
                <Th className="text-right">Current</Th><Th>Status</Th><Th></Th></Tr>
            </Thead>
            <Tbody>
              {floats.map((f) => (
                <Tr key={f.id}>
                  <Td>{f.location_name || `#${f.location_id}`}</Td>
                  <Td>{f.custodian_name || '—'}</Td>
                  <Td className="mono">{f.chart_account_code}</Td>
                  <Td className="text-right mono">{formatCurrency(f.imprest_amount)}</Td>
                  <Td className="text-right mono">{formatCurrency(f.replenishment_threshold)}</Td>
                  <Td className="text-right mono font-medium">{formatCurrency(f.current_balance ?? '0')}</Td>
                  <Td>{f.needs_replenishment ?
                    <Badge variant="error">Low — replenish</Badge> :
                    <Badge variant="success">OK</Badge>}</Td>
                  <Td className="flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setSpendFor(f)}>
                      <ArrowDown size={14} /> Spend
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setReplenishFor(f)}>
                      <ArrowUp size={14} /> Replenish
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setTxnsFor(f)}>
                      <Eye size={14} />
                    </Button>
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </Card>
      )}

      <NewFloatDialog open={showDialog} onClose={() => setShowDialog(false)} onSaved={load} />
      <SpendDialog floatObj={spendFor} onClose={() => setSpendFor(null)} onDone={load} />
      <ReplenishDialog floatObj={replenishFor} onClose={() => setReplenishFor(null)} onDone={load} />
      <TxnsDialog floatObj={txnsFor} onClose={() => setTxnsFor(null)} />
    </div>
  )
}

function NewFloatDialog({ open, onClose, onSaved }: any) {
  const [data, setData] = useState({
    location_id: '', location_name: '', chart_account: '',
    imprest_amount: '5000', replenishment_threshold: '1000',
    custodian_name: '',
  })
  return (
    <Dialog open={open} onOpenChange={(o: boolean) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>New Petty Cash Float</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <Input placeholder="Location ID" value={data.location_id}
                 onChange={(e) => setData({ ...data, location_id: e.target.value })} />
          <Input placeholder="Location name" value={data.location_name}
                 onChange={(e) => setData({ ...data, location_name: e.target.value })} />
          <Input placeholder="Cash GL account ID" value={data.chart_account}
                 onChange={(e) => setData({ ...data, chart_account: e.target.value })} />
          <Input placeholder="Custodian name" value={data.custodian_name}
                 onChange={(e) => setData({ ...data, custodian_name: e.target.value })} />
          <Input placeholder="Imprest amount ₹" value={data.imprest_amount}
                 onChange={(e) => setData({ ...data, imprest_amount: e.target.value })} />
          <Input placeholder="Replenish threshold ₹" value={data.replenishment_threshold}
                 onChange={(e) => setData({ ...data, replenishment_threshold: e.target.value })} />
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={async () => {
            try {
              await createPettyCashFloat({
                ...data,
                location_id: parseInt(data.location_id) as any,
                chart_account: parseInt(data.chart_account) as any,
              })
              toast.success('Float created'); onSaved(); onClose()
            } catch (e: any) { toast.error(e?.response?.data?.detail || 'Failed') }
          }}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function SpendDialog({ floatObj, onClose, onDone }: any) {
  const [data, setData] = useState({
    date: new Date().toISOString().slice(0, 10),
    amount: '', expense_account: '', description: '', voucher_no: '',
  })
  if (!floatObj) return null
  return (
    <Dialog open={!!floatObj} onOpenChange={(o: boolean) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Petty Cash Spend</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <Input type="date" value={data.date} onChange={(e) => setData({ ...data, date: e.target.value })} />
          <Input placeholder="Amount ₹" value={data.amount} onChange={(e) => setData({ ...data, amount: e.target.value })} />
          <Input placeholder="Expense GL account ID" value={data.expense_account}
                 onChange={(e) => setData({ ...data, expense_account: e.target.value })} />
          <Input placeholder="Description" value={data.description}
                 onChange={(e) => setData({ ...data, description: e.target.value })} />
          <Input placeholder="Voucher no. (optional)" value={data.voucher_no}
                 onChange={(e) => setData({ ...data, voucher_no: e.target.value })} />
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={async () => {
            try {
              await spendPettyCash(floatObj.id, { ...data, expense_account: parseInt(data.expense_account) })
              toast.success('Spend recorded'); onDone(); onClose()
            } catch (e: any) { toast.error(e?.response?.data?.detail || 'Failed') }
          }}>Record Spend</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ReplenishDialog({ floatObj, onClose, onDone }: any) {
  const [data, setData] = useState({
    date: new Date().toISOString().slice(0, 10),
    amount: '', source: 'bank',
  })
  if (!floatObj) return null
  return (
    <Dialog open={!!floatObj} onOpenChange={(o: boolean) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Replenish Petty Cash</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <Input type="date" value={data.date} onChange={(e) => setData({ ...data, date: e.target.value })} />
          <Input placeholder="Amount ₹" value={data.amount} onChange={(e) => setData({ ...data, amount: e.target.value })} />
          <select className="border rounded px-2 py-1.5 w-full" value={data.source}
                  onChange={(e) => setData({ ...data, source: e.target.value })}>
            <option value="bank">From Bank</option>
            <option value="cash">From Cash</option>
          </select>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={async () => {
            try { await replenishPettyCash(floatObj.id, data); toast.success('Replenished'); onDone(); onClose() }
            catch (e: any) { toast.error(e?.response?.data?.detail || 'Failed') }
          }}>Replenish</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function TxnsDialog({ floatObj, onClose }: any) {
  const [txns, setTxns] = useState<PettyCashTxn[]>([])
  const [balance, setBalance] = useState('0')
  useEffect(() => {
    if (!floatObj) return
    getPettyCashTxns(floatObj.id)
      .then((r) => { setTxns(r.rows); setBalance(r.current_balance) })
      .catch(() => toast.error('Failed'))
  }, [floatObj])
  if (!floatObj) return null
  return (
    <Dialog open={!!floatObj} onOpenChange={(o: boolean) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader><DialogTitle>{floatObj.location_name} — current ₹{balance}</DialogTitle></DialogHeader>
        <div className="max-h-[60vh] overflow-auto">
          <Table>
            <Thead><Tr><Th>Date</Th><Th>Kind</Th><Th>Description</Th>
              <Th className="text-right">Amount</Th><Th>Voucher</Th></Tr></Thead>
            <Tbody>
              {txns.map((t) => (
                <Tr key={t.id}>
                  <Td>{formatDate(t.date)}</Td>
                  <Td><Badge variant={t.kind === 'spend' ? 'error' : 'success'}>{t.kind}</Badge></Td>
                  <Td>{t.description}</Td>
                  <Td className="text-right mono">{formatCurrency(t.amount)}</Td>
                  <Td>{t.voucher_no || '—'}</Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </div>
        <DialogFooter><Button variant="secondary" onClick={onClose}>Close</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
