import { useEffect, useMemo, useState } from 'react'
import { Plus, Play } from 'lucide-react'
import { toast } from 'sonner'
import {
  listFixedAssets, listAssetClasses, createFixedAsset, createAssetClass,
  postAssetAcquisition, disposeAsset, previewDepreciation, postDepreciation,
  getChartOfAccounts,
  type FixedAsset, type AssetClass, type Account,
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

function DialogFooter({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap gap-2 justify-end mt-4">{children}</div>
}

export default function FixedAssetsPage() {
  const [assets, setAssets] = useState<FixedAsset[]>([])
  const [classes, setClasses] = useState<AssetClass[]>([])
  const [loading, setLoading] = useState(true)
  const [showAssetDialog, setShowAssetDialog] = useState(false)
  const [showClassDialog, setShowClassDialog] = useState(false)
  const [showDepDialog, setShowDepDialog] = useState(false)
  const [showDisposeDialog, setShowDisposeDialog] = useState<FixedAsset | null>(null)

  async function load() {
    setLoading(true)
    try {
      const [a, c] = await Promise.all([listFixedAssets(), listAssetClasses()])
      const aRows = Array.isArray(a) ? a : (a.results ?? [])
      setAssets(aRows)
      setClasses(c)
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Failed to load assets'))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-lg sm:text-xl font-semibold" style={{ color: 'var(--ink)', letterSpacing: '-0.01em' }}>
            Fixed Assets
          </h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--ink-2)' }}>
            <span className="mono">{assets.length}</span> assets · {classes.length} classes
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setShowClassDialog(true)}>
            <Plus size={16} /> Asset Class
          </Button>
          <Button variant="secondary" onClick={() => setShowDepDialog(true)}>
            <Play size={16} /> Run Depreciation
          </Button>
          <Button onClick={() => setShowAssetDialog(true)} disabled={!classes.length}>
            <Plus size={16} /> New Asset
          </Button>
        </div>
      </div>

      {loading ? (
        <SkeletonTable />
      ) : assets.length === 0 ? (
        <EmptyState
          title="No assets yet"
          description="Add your first asset class, then capture an asset (e.g. computer, furniture)."
        />
      ) : (
        <Card>
          <Table>
            <Thead>
              <Tr>
                <Th>Asset No.</Th>
                <Th>Name</Th>
                <Th>Class</Th>
                <Th>Acquired</Th>
                <Th className="text-right">Cost</Th>
                <Th className="text-right">Accum. Dep.</Th>
                <Th className="text-right">NBV</Th>
                <Th>Status</Th>
                <Th></Th>
              </Tr>
            </Thead>
            <Tbody>
              {assets.map((a) => (
                <Tr key={a.id}>
                  <Td className="mono">{a.asset_no}</Td>
                  <Td>{a.name}</Td>
                  <Td>{a.asset_class_name}</Td>
                  <Td>{formatDate(a.acquisition_date)}</Td>
                  <Td className="text-right mono">{formatCurrency(a.acquisition_cost)}</Td>
                  <Td className="text-right mono">{formatCurrency(a.accumulated_depreciation ?? '0')}</Td>
                  <Td className="text-right mono font-medium">{formatCurrency(a.net_book_value ?? a.acquisition_cost)}</Td>
                  <Td>
                    <Badge variant={a.status === 'active' ? 'success' : 'default'}>{a.status}</Badge>
                  </Td>
                  <Td>
                    {a.status === 'active' && !a.acquisition_entry_no && (
                      <Button size="sm" variant="ghost" onClick={async () => {
                        try { await postAssetAcquisition(a.id); toast.success('Acquisition JE posted'); load() }
                        catch (e) { toast.error(apiErrorMessage(e, 'Could not post acquisition')) }
                      }}>Post Acq.</Button>
                    )}
                    {a.status === 'active' && a.acquisition_entry_no && (
                      <Button size="sm" variant="ghost" onClick={() => setShowDisposeDialog(a)}>Dispose</Button>
                    )}
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </Card>
      )}

      <AssetClassDialog open={showClassDialog} onClose={() => setShowClassDialog(false)} onSaved={load} />
      <AssetDialog open={showAssetDialog} classes={classes} onClose={() => setShowAssetDialog(false)} onSaved={load} />
      <DepreciationDialog open={showDepDialog} onClose={() => setShowDepDialog(false)} onPosted={load} />
      <DisposeDialog asset={showDisposeDialog} onClose={() => setShowDisposeDialog(null)} onDone={load} />
    </div>
  )
}

function AssetClassDialog({ open, onClose, onSaved }: any) {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [data, setData] = useState({ code: '', name: '', dep_method: 'SLM', useful_life_years: 5,
    wdv_rate_pct: '0', salvage_value_pct: '5',
    asset_account: null as number | null,
    accum_dep_account: null as number | null,
    dep_expense_account: null as number | null })

  useEffect(() => {
    if (open) getChartOfAccounts().then(setAccounts).catch(() => {/* pickers degrade */})
  }, [open])

  // These were free-text "account ID" boxes; an operator naturally typed the
  // account code (1640) rather than its database id, and the server answered
  // 'Invalid pk "1640"' -- which the dialog reported as the word "Failed".
  const assetAccounts = useMemo(
    () => accounts.filter((a) => a.account_type === 'ASSET'), [accounts])
  const expenseAccounts = useMemo(
    () => accounts.filter((a) => a.account_type === 'EXPENSE'), [accounts])

  return (
    <Dialog open={open} onOpenChange={(o: boolean) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>New Asset Class</DialogTitle></DialogHeader>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input placeholder="Code (e.g. COMP)" value={data.code} onChange={(e) => setData({ ...data, code: e.target.value })} />
          <Input placeholder="Name (e.g. Computers)" value={data.name} onChange={(e) => setData({ ...data, name: e.target.value })} />
          <select className="border rounded px-2 py-1.5" value={data.dep_method}
                  onChange={(e) => setData({ ...data, dep_method: e.target.value })}>
            <option value="SLM">SLM (Straight Line)</option>
            <option value="WDV">WDV (Written-Down Value)</option>
          </select>
          <Input type="number" placeholder="Useful life (years)" value={data.useful_life_years}
                 onChange={(e) => setData({ ...data, useful_life_years: parseInt(e.target.value || '0') })} />
          <Input placeholder="WDV rate %" value={data.wdv_rate_pct}
                 onChange={(e) => setData({ ...data, wdv_rate_pct: e.target.value })} />
          <Input placeholder="Salvage value %" value={data.salvage_value_pct}
                 onChange={(e) => setData({ ...data, salvage_value_pct: e.target.value })} />
          <label className="block text-xs font-medium text-slate-600">
            Asset GL
            <AccountPicker accounts={assetAccounts} value={data.asset_account}
              onChange={(id) => setData({ ...data, asset_account: id })} />
          </label>
          <label className="block text-xs font-medium text-slate-600">
            Accumulated depreciation GL
            <AccountPicker accounts={assetAccounts} value={data.accum_dep_account}
              onChange={(id) => setData({ ...data, accum_dep_account: id })} />
          </label>
          <label className="block text-xs font-medium text-slate-600">
            Depreciation expense GL
            <AccountPicker accounts={expenseAccounts} value={data.dep_expense_account}
              onChange={(id) => setData({ ...data, dep_expense_account: id })} />
          </label>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={async () => {
            if (!data.asset_account || !data.accum_dep_account || !data.dep_expense_account) {
              toast.error('Pick all three GL accounts for this class.')
              return
            }
            try {
              await createAssetClass({ ...data, dep_method: data.dep_method as 'SLM' | 'WDV' } as any)
              toast.success('Asset class created')
              onSaved(); onClose()
            } catch (e: any) { toast.error(apiErrorMessage(e, 'Could not save.')) }
          }}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function AssetDialog({ open, classes, onClose, onSaved }: any) {
  const { activeLocationId } = useLocation()
  const [data, setData] = useState({
    asset_no: '', name: '', asset_class: '',
    acquisition_date: new Date().toISOString().slice(0, 10),
    acquisition_cost: '', salvage_value: '0', useful_life_months: 0,
    vendor_name: '',
  })
  return (
    <Dialog open={open} onOpenChange={(o: boolean) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>New Fixed Asset</DialogTitle></DialogHeader>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input placeholder="Asset number" value={data.asset_no} onChange={(e) => setData({ ...data, asset_no: e.target.value })} />
          <Input placeholder="Name" value={data.name} onChange={(e) => setData({ ...data, name: e.target.value })} />
          {classes.length === 0 ? (
            <div className="text-xs rounded px-2.5 py-2" style={{
              background: 'rgba(199,122,17,0.08)', color: 'var(--warning)',
            }}>
              No asset classes defined yet — create one first, or an asset has
              no depreciation rules to follow.
            </div>
          ) : (
            <select className="border rounded px-2 py-1.5" value={data.asset_class}
                    onChange={(e) => setData({ ...data, asset_class: e.target.value })}>
              <option value="">Select class…</option>
              {classes.map((c: AssetClass) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
            </select>
          )}
          <Input type="date" value={data.acquisition_date}
                 onChange={(e) => setData({ ...data, acquisition_date: e.target.value })} />
          <Input placeholder="Acquisition cost ₹" value={data.acquisition_cost}
                 onChange={(e) => setData({ ...data, acquisition_cost: e.target.value })} />
          <Input placeholder="Salvage value ₹" value={data.salvage_value}
                 onChange={(e) => setData({ ...data, salvage_value: e.target.value })} />
          <Input placeholder="Vendor name" value={data.vendor_name}
                 onChange={(e) => setData({ ...data, vendor_name: e.target.value })} />
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button disabled={classes.length === 0} onClick={async () => {
            // An empty select yields '' -> parseInt -> NaN, which JSON.stringify
            // sends as null, and the server rightly refuses it.
            if (!data.asset_class) { toast.error('Pick an asset class.'); return }
            try {
              await createFixedAsset({
                ...data, asset_class: parseInt(data.asset_class) as any,
                location_id: activeLocationId ?? null,
              })
              toast.success('Asset created'); onSaved(); onClose()
            } catch (e: any) { toast.error(apiErrorMessage(e, 'Could not save.')) }
          }}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DepreciationDialog({ open, onClose, onPosted }: any) {
  const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7))
  const [preview, setPreview] = useState<any>(null)
  return (
    <Dialog open={open} onOpenChange={(o: boolean) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Run Monthly Depreciation</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <Input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} />
          <Button variant="secondary" onClick={async () => {
            try { setPreview(await previewDepreciation(period)) }
            catch (e) { toast.error(apiErrorMessage(e, 'Preview failed')) }
          }}>Preview</Button>
          {preview && (
            <Card className="p-3 text-sm">
              <div>{preview.rows?.length || 0} assets, total <strong>{formatCurrency(preview.total)}</strong></div>
            </Card>
          )}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button disabled={!preview} onClick={async () => {
            try { await postDepreciation(period); toast.success('Depreciation posted'); onPosted(); onClose() }
            catch (e: any) { toast.error(apiErrorMessage(e, 'Could not save.')) }
          }}>Post</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DisposeDialog({ asset, onClose, onDone }: any) {
  const [data, setData] = useState({ disposal_date: new Date().toISOString().slice(0, 10), proceeds: '0', mode: 'bank' })
  if (!asset) return null
  return (
    <Dialog open={!!asset} onOpenChange={(o: boolean) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle className="min-w-0 break-words">Dispose {asset.asset_no} — {asset.name}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="text-sm" style={{ color: 'var(--ink-2)' }}>
            NBV: {formatCurrency(asset.net_book_value ?? asset.acquisition_cost)}
          </div>
          <Input type="date" value={data.disposal_date}
                 onChange={(e) => setData({ ...data, disposal_date: e.target.value })} />
          <Input placeholder="Sale proceeds ₹" value={data.proceeds}
                 onChange={(e) => setData({ ...data, proceeds: e.target.value })} />
          <select className="border rounded px-2 py-1.5 w-full" value={data.mode}
                  onChange={(e) => setData({ ...data, mode: e.target.value })}>
            <option value="bank">Bank</option>
            <option value="cash">Cash</option>
          </select>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={async () => {
            try { await disposeAsset(asset.id, data); toast.success('Asset disposed'); onDone(); onClose() }
            catch (e: any) { toast.error(apiErrorMessage(e, 'Could not save.')) }
          }}>Dispose</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
