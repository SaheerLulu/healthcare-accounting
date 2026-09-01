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
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { AccountPicker } from '../journals/AccountPicker'
import { usePageKeyboard } from '../../hooks/usePageKeyboard'
import { useListKeyboardNav } from '../../hooks/useListKeyboardNav'

function DialogFooter({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap gap-2 justify-end mt-4">{children}</div>
}

/**
 * Escape inside an AccountPicker dropdown must close only the dropdown.
 * The picker closes itself but does not stop the event, and Radix dismisses the
 * dialog from a document-level listener — so one Escape tore down the whole
 * form and everything typed into it. The picker renders through a portal, so
 * the surviving signal is the event target's own ancestry (it stays intact even
 * once the portal has been detached).
 */
function keepDialogOpenForPicker(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null
  if (t && typeof t.closest === 'function' && t.closest('.dropdown-animate')) {
    e.preventDefault()
  }
}

export default function FixedAssetsPage() {
  const [assets, setAssets] = useState<FixedAsset[]>([])
  const [classes, setClasses] = useState<AssetClass[]>([])
  const [loading, setLoading] = useState(true)
  const [showAssetDialog, setShowAssetDialog] = useState(false)
  const [showClassDialog, setShowClassDialog] = useState(false)
  const [showDepDialog, setShowDepDialog] = useState(false)
  const [showDisposeDialog, setShowDisposeDialog] = useState<FixedAsset | null>(null)
  const [confirmPost, setConfirmPost] = useState<FixedAsset | null>(null)
  const [posting, setPosting] = useState(false)

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

  async function postAcq(a: FixedAsset) {
    setPosting(true)
    try {
      await postAssetAcquisition(a.id)
      toast.success('Acquisition JE posted')
      await load()
      // The focused "Post Acq." button has just been replaced by "Dispose";
      // put focus back on its row so the register can be worked down the list.
      window.setTimeout(() => list.focusList(), 0)
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Could not post acquisition'))
    } finally {
      setPosting(false)
      setConfirmPost(null)
    }
  }

  /**
   * No onActivate, deliberately. There is no per-asset screen to open, so the
   * only things a row could "activate" are its two writes — and Enter on a row
   * is not an aimed press: posting an acquisition JE (immutable once posted)
   * or opening a disposal off a stray Enter is exactly what must not happen.
   *
   * It also fixes the half of this that no keyboard could reach: onActivate is
   * what stamps role="button" on the row, and the row had no onClick, so
   * assistive tech — which activates a role="button" by dispatching a click,
   * not a keydown — was told every active row was a button and then got
   * nothing when it pressed one. Without the role the row is an ordinary table
   * row again, honestly described, and ↑↓/Home/End/PgUp/PgDn still walk the
   * register through a single roving tab stop.
   *
   * The two actions live in their own focusable buttons in the row, one Tab
   * from it: "Post Acq." (through the confirm below) and "Dispose" (through
   * its own dialog).
   */
  const list = useListKeyboardNav({ count: assets.length })

  usePageKeyboard({
    actions: [
      { chord: 'Alt+N', label: 'New asset', run: () => setShowAssetDialog(true), when: classes.length > 0 },
      // NOT Alt+C: on a list screen that chord means "clear filters", and in a
      // voucher it means "create ledger" — a third meaning would make it mean
      // nothing. The secondary master-create takes an unreserved chord instead.
      { chord: 'Alt+K', label: 'New asset class', run: () => setShowClassDialog(true) },
      // Opening the dialog is not the run: it previews first, and Post inside
      // it stays a separate, deliberate press.
      { chord: 'Alt+G', label: 'Run depreciation', run: () => setShowDepDialog(true) },
      { chord: 'Alt+R', label: 'Refresh', run: load },
    ],
    onFocusList: list.focusList,
  })

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
          <Button variant="secondary" title="New asset class (Alt+K)" onClick={() => setShowClassDialog(true)}>
            <Plus size={16} /> Asset Class
          </Button>
          <Button variant="secondary" title="Run depreciation (Alt+G)" onClick={() => setShowDepDialog(true)}>
            <Play size={16} /> Run Depreciation
          </Button>
          <Button title="New asset (Alt+N)" onClick={() => setShowAssetDialog(true)} disabled={!classes.length}>
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
            <Tbody {...list.containerProps}>
              {assets.map((a, i) => (
                <Tr key={a.id}
                  aria-label={`Asset ${a.asset_no} — ${a.name} — ${a.status}`}
                  {...list.rowProps(i)}>
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
                      <Button size="sm" variant="ghost"
                        aria-label={`Post acquisition JE for ${a.asset_no}`}
                        onClick={() => setConfirmPost(a)}>Post Acq.</Button>
                    )}
                    {a.status === 'active' && a.acquisition_entry_no && (
                      <Button size="sm" variant="ghost"
                        aria-label={`Dispose ${a.asset_no}`}
                        onClick={() => setShowDisposeDialog(a)}>Dispose</Button>
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
      <DisposeDialog asset={showDisposeDialog} onClose={() => setShowDisposeDialog(null)}
        onDone={async () => { await load(); window.setTimeout(() => list.focusList(), 0) }} />

      {/* The single route to a posted acquisition JE — the row's "Post Acq."
          button opens this rather than writing. Danger tone lands focus on
          Cancel, so a reflexive Enter on the confirm backs out. */}
      <ConfirmDialog
        open={!!confirmPost}
        onOpenChange={(o: boolean) => {
          if (o) return
          setConfirmPost(null)
          // Radix restores focus to the button it opened from, which after a
          // successful post has been replaced by "Dispose" — so focus would
          // land on <body>. Put the cursor back on the register instead, which
          // is where the next asset is worked from either way.
          window.setTimeout(() => list.focusList(), 0)
        }}
        title={confirmPost ? `Post the acquisition JE for ${confirmPost.asset_no}?` : ''}
        description="The journal entry is immutable once posted — it can only be reversed, never edited."
        confirmLabel="Post JE"
        cancelLabel="Cancel"
        tone="danger"
        loading={posting}
        onConfirm={() => { if (confirmPost && !posting) postAcq(confirmPost) }}
      />
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

  async function save() {
    if (!data.asset_account || !data.accum_dep_account || !data.dep_expense_account) {
      toast.error('Pick all three GL accounts for this class.')
      return
    }
    try {
      await createAssetClass({ ...data, dep_method: data.dep_method as 'SLM' | 'WDV' } as any)
      toast.success('Asset class created')
      onSaved(); onClose()
    } catch (e: any) { toast.error(apiErrorMessage(e, 'Could not save.')) }
  }

  return (
    <Dialog open={open} onOpenChange={(o: boolean) => !o && onClose()}>
      <DialogContent onEscapeKeyDown={keepDialogOpenForPicker}>
        <DialogHeader><DialogTitle>New Asset Class</DialogTitle></DialogHeader>
        {/* A real <form>: Enter in any field saves, instead of the operator
            Tabbing past six inputs, a select and three pickers to reach Save. */}
        <form onSubmit={(e) => { e.preventDefault(); save() }}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input data-autofocus placeholder="Code (e.g. COMP)" value={data.code} onChange={(e) => setData({ ...data, code: e.target.value })} />
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
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit">Save</Button>
        </DialogFooter>
        </form>
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
  async function save() {
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
  }

  return (
    <Dialog open={open} onOpenChange={(o: boolean) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>New Fixed Asset</DialogTitle></DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); save() }}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input data-autofocus placeholder="Asset number" value={data.asset_no} onChange={(e) => setData({ ...data, asset_no: e.target.value })} />
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
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={classes.length === 0}>Save</Button>
        </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function DepreciationDialog({ open, onClose, onPosted }: any) {
  const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7))
  const [preview, setPreview] = useState<any>(null)
  async function runPreview() {
    try { setPreview(await previewDepreciation(period)) }
    catch (e) { toast.error(apiErrorMessage(e, 'Preview failed')) }
  }

  return (
    <Dialog open={open} onOpenChange={(o: boolean) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Run Monthly Depreciation</DialogTitle></DialogHeader>
        {/* Enter in the period box runs the Preview — Post stays a deliberate,
            separate press, since it writes a JE for every active asset. */}
        <form onSubmit={(e) => { e.preventDefault(); runPreview() }}>
        <div className="space-y-3">
          <Input data-autofocus type="month" value={period} onChange={(e) => setPeriod(e.target.value)} />
          <Button type="submit" variant="secondary">Preview</Button>
          {preview && (
            <Card className="p-3 text-sm">
              <div>{preview.rows?.length || 0} assets, total <strong>{formatCurrency(preview.total)}</strong></div>
            </Card>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="button" disabled={!preview} onClick={async () => {
            try { await postDepreciation(period); toast.success('Depreciation posted'); onPosted(); onClose() }
            catch (e: any) { toast.error(apiErrorMessage(e, 'Could not save.')) }
          }}>Post</Button>
        </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function DisposeDialog({ asset, onClose, onDone }: any) {
  const [data, setData] = useState({ disposal_date: new Date().toISOString().slice(0, 10), proceeds: '0', mode: 'bank' })
  if (!asset) return null
  async function save() {
    try { await disposeAsset(asset.id, data); toast.success('Asset disposed'); onDone(); onClose() }
    catch (e: any) { toast.error(apiErrorMessage(e, 'Could not save.')) }
  }

  return (
    <Dialog open={!!asset} onOpenChange={(o: boolean) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle className="min-w-0 break-words">Dispose {asset.asset_no} — {asset.name}</DialogTitle></DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); save() }}>
        <div className="space-y-3">
          <div className="text-sm" style={{ color: 'var(--ink-2)' }}>
            NBV: {formatCurrency(asset.net_book_value ?? asset.acquisition_cost)}
          </div>
          <Input data-autofocus type="date" value={data.disposal_date}
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
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit">Dispose</Button>
        </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
