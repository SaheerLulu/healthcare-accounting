import { useEffect, useState } from 'react'
import { Plus, CheckCircle2, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import {
  listCheques, createCheque, clearCheque, bounceCheque,
  type Cheque,
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../../components/ui/tabs'

function DialogFooter({ children }: { children: React.ReactNode }) {
  return <div className="flex gap-2 justify-end mt-4">{children}</div>
}

export default function ChequesPage() {
  const [cheques, setCheques] = useState<Cheque[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'all' | 'issued' | 'received' | 'pdc'>('all')
  const [showDialog, setShowDialog] = useState(false)
  const [bounceFor, setBounceFor] = useState<Cheque | null>(null)

  async function load() {
    setLoading(true)
    try {
      const params: Record<string, string> = {}
      if (tab === 'issued' || tab === 'received') params.kind = tab
      if (tab === 'pdc') params.pdc = 'true'
      const r = await listCheques(params)
      setCheques(Array.isArray(r) ? r : (r.results ?? []))
    } catch { toast.error('Failed to load cheques') }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [tab])

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--ink)', letterSpacing: '-0.01em' }}>Cheques</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--ink-2)' }}>
            <span className="mono">{cheques.length}</span> cheques in view
          </p>
        </div>
        <Button onClick={() => setShowDialog(true)}><Plus size={16} /> New Cheque</Button>
      </div>

      <Tabs value={tab} onValueChange={(v: any) => setTab(v)}>
        <TabsList>
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="issued">Issued</TabsTrigger>
          <TabsTrigger value="received">Received</TabsTrigger>
          <TabsTrigger value="pdc">PDC (post-dated)</TabsTrigger>
        </TabsList>
        <TabsContent value={tab}>
          {loading ? <SkeletonTable /> : cheques.length === 0 ? (
            <EmptyState title="No cheques in this view" description="Add a cheque you issued or received." />
          ) : (
            <Card>
              <Table>
                <Thead>
                  <Tr><Th>Cheque No.</Th><Th>Kind</Th><Th>Date</Th><Th>Expected Clear</Th>
                    <Th>Bank</Th><Th>Party</Th><Th className="text-right">Amount</Th>
                    <Th>Status</Th><Th></Th></Tr>
                </Thead>
                <Tbody>
                  {cheques.map((c) => (
                    <Tr key={c.id}>
                      <Td className="mono">{c.cheque_no}</Td>
                      <Td><Badge variant={c.kind === 'issued' ? 'default' : 'success'}>{c.kind}</Badge></Td>
                      <Td>{formatDate(c.cheque_date)}</Td>
                      <Td>{c.expected_clear_date ? formatDate(c.expected_clear_date) : '—'}</Td>
                      <Td>{c.bank_account_name}</Td>
                      <Td>{c.party_name || '—'}</Td>
                      <Td className="text-right mono">{formatCurrency(c.amount)}</Td>
                      <Td>
                        <Badge variant={
                          c.status === 'cleared' ? 'success' :
                          c.status === 'bounced' ? 'error' :
                          'default'
                        }>{c.status}</Badge>
                      </Td>
                      <Td className="flex gap-1">
                        {c.status === 'pending' && (
                          <>
                            <Button size="sm" variant="ghost" onClick={async () => {
                              try { await clearCheque(c.id); toast.success('Cleared'); load() }
                              catch { toast.error('Failed') }
                            }}><CheckCircle2 size={14} /> Clear</Button>
                            <Button size="sm" variant="ghost" onClick={() => setBounceFor(c)}>
                              <AlertTriangle size={14} /> Bounce
                            </Button>
                          </>
                        )}
                      </Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      <NewChequeDialog open={showDialog} onClose={() => setShowDialog(false)} onSaved={load} />
      <BounceDialog cheque={bounceFor} onClose={() => setBounceFor(null)} onDone={load} />
    </div>
  )
}

function NewChequeDialog({ open, onClose, onSaved }: any) {
  const [data, setData] = useState({
    cheque_no: '', kind: 'issued', bank_account: '',
    cheque_date: new Date().toISOString().slice(0, 10),
    expected_clear_date: '',
    amount: '', party_type: '', party_id: '', party_name: '',
    location_id: '',
  })
  return (
    <Dialog open={open} onOpenChange={(o: boolean) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>New Cheque</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <Input placeholder="Cheque no." value={data.cheque_no} onChange={(e) => setData({ ...data, cheque_no: e.target.value })} />
          <select className="border rounded px-2 py-1.5" value={data.kind}
                  onChange={(e) => setData({ ...data, kind: e.target.value })}>
            <option value="issued">Issued (we paid)</option>
            <option value="received">Received (we collected)</option>
          </select>
          <Input placeholder="Bank account ID" value={data.bank_account}
                 onChange={(e) => setData({ ...data, bank_account: e.target.value })} />
          <Input type="date" value={data.cheque_date}
                 onChange={(e) => setData({ ...data, cheque_date: e.target.value })} />
          <Input type="date" placeholder="Expected clear (PDC)" value={data.expected_clear_date}
                 onChange={(e) => setData({ ...data, expected_clear_date: e.target.value })} />
          <Input placeholder="Amount ₹" value={data.amount}
                 onChange={(e) => setData({ ...data, amount: e.target.value })} />
          <select className="border rounded px-2 py-1.5" value={data.party_type}
                  onChange={(e) => setData({ ...data, party_type: e.target.value })}>
            <option value="">— party type —</option>
            <option value="Customer">Customer</option>
            <option value="Supplier">Supplier</option>
          </select>
          <Input placeholder="Party name" value={data.party_name}
                 onChange={(e) => setData({ ...data, party_name: e.target.value })} />
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={async () => {
            try {
              await createCheque({
                ...data,
                kind: data.kind as 'issued' | 'received',
                bank_account: parseInt(data.bank_account) as any,
                expected_clear_date: data.expected_clear_date || null,
                party_id: data.party_id ? parseInt(data.party_id) : null,
                location_id: data.location_id ? parseInt(data.location_id) : null,
              } as any)
              toast.success('Cheque saved'); onSaved(); onClose()
            } catch (e: any) { toast.error(e?.response?.data?.detail || 'Failed') }
          }}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function BounceDialog({ cheque, onClose, onDone }: any) {
  const [reason, setReason] = useState('')
  const [bankCharge, setBankCharge] = useState('')
  if (!cheque) return null
  return (
    <Dialog open={!!cheque} onOpenChange={(o: boolean) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Bounce cheque {cheque.cheque_no}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <p className="text-sm" style={{ color: 'var(--ink-2)' }}>
            This will reverse the original journal entry and roll back any linked bill payment.
          </p>
          <Input placeholder="Reason (e.g. insufficient funds)" value={reason}
                 onChange={(e) => setReason(e.target.value)} />
          <Input placeholder="Bank charge ₹ (optional)" value={bankCharge}
                 onChange={(e) => setBankCharge(e.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={async () => {
            try { await bounceCheque(cheque.id, reason, bankCharge || undefined); toast.success('Marked as bounced'); onDone(); onClose() }
            catch (e: any) { toast.error(e?.response?.data?.detail || 'Failed') }
          }}>Mark Bounced</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
