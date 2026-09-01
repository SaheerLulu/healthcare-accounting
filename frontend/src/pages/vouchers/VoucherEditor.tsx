import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Loader2, Plus, Save, Send, History, Check, FileStack, Layers, Globe, Calculator } from 'lucide-react'
import { toast } from 'sonner'
import {
  getChartOfAccounts, getJournalEntry, getJournalEntries, getSuppliers, getCustomers,
  createJournalEntry, updateJournalEntry, postEntry,
  createBillReference, getAllAccountMappingKeys,
  type Account, type JournalEntry, type Party,
} from '../../lib/api'
import { formatCurrency } from '../../lib/utils'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Card } from '../../components/ui/card'
import { Badge } from '../../components/ui/badge'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { useLocation as useActiveLocation } from '../../contexts/LocationContext'
import { usePageKeyboard } from '../../hooks/usePageKeyboard'
import { useGridKeyboardNav } from '../../hooks/useGridKeyboardNav'
import {
  VoucherLineRow, VOUCHER_LINE_COLUMNS, voucherLineCellId, type VoucherLine,
} from './VoucherLineRow'
import { CreateLedgerModal } from './CreateLedgerModal'
import { BillAllocationSheet } from './BillAllocationSheet'
import { CostCenterPopup } from './CostCenterPopup'
import { PartySearchPicker } from '../parties/PartySearchPicker'
import { voucherConfigs, type VoucherConfig, type VoucherType } from './voucherConfig'
import { GstHelperPopup, type GstLedgers, type GstSide, type GstInsertLine } from './GstHelperPopup'

const EMPTY_GST_LEDGERS: GstLedgers = {
  INPUT_CGST: null, INPUT_SGST: null, INPUT_IGST: null,
  OUTPUT_CGST: null, OUTPUT_SGST: null, OUTPUT_IGST: null,
}

function uid() {
  return Math.random().toString(36).slice(2)
}

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

function makeLine(side: 'Dr' | 'Cr'): VoucherLine {
  return { uid: uid(), side, account: null, amount: '', narration: '' }
}

/** Flatten a DRF error payload value, recursing into nested `lines` error
 * arrays/objects so the toast shows real messages, not [object Object]. */
function flattenErrValue(v: unknown): string {
  if (Array.isArray(v)) {
    return v.map(flattenErrValue).filter(Boolean).join(', ')
  }
  if (v && typeof v === 'object') {
    return Object.entries(v as Record<string, unknown>)
      .map(([k, inner]) => {
        const flat = flattenErrValue(inner)
        return flat ? `${k}: ${flat}` : ''
      })
      .filter(Boolean)
      .join('; ')
  }
  return v == null ? '' : String(v)
}

interface VoucherEditorProps {
  voucherType: VoucherType
}

export default function VoucherEditor({ voucherType }: VoucherEditorProps) {
  const config: VoucherConfig = voucherConfigs[voucherType]
  const { id } = useParams<{ id?: string }>()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const editingId = id ? Number(id) : null
  const { activeLocationId } = useActiveLocation()
  const initialPartyId = searchParams.get('party_id')
    ? Number(searchParams.get('party_id'))
    : null
  const autoOpenAlloc = searchParams.get('alloc') === '1'

  const [accounts, setAccounts] = useState<Account[]>([])
  const [parties, setParties] = useState<Party[]>([])
  const [partyId, setPartyId] = useState<number | ''>('')
  const [date, setDate] = useState(todayStr())
  const [referenceId, setReferenceId] = useState('')
  const [narration, setNarration] = useState(config.narrationTemplate)
  const [costCenter, setCostCenter] = useState('')
  const [costCentreId, setCostCentreId] = useState<number | null>(null)
  const [voucherTypeProfileId, setVoucherTypeProfileId] = useState<number | null>(null)
  const [lines, setLines] = useState<VoucherLine[]>([
    makeLine(config.firstLineSide),
    makeLine(config.secondLineSide),
  ])
  const [loading, setLoading] = useState(!!editingId)
  const [saving, setSaving] = useState(false)
  const [posting, setPosting] = useState(false)
  const [originalEntry, setOriginalEntry] = useState<JournalEntry | null>(null)
  const [escConfirmOpen, setEscConfirmOpen] = useState(false)
  const [createLedgerOpen, setCreateLedgerOpen] = useState(false)
  const [allocOpen, setAllocOpen] = useState(false)
  const [costCenterOpen, setCostCenterOpen] = useState(false)
  const [gstOpen, setGstOpen] = useState(false)
  const [gstLedgers, setGstLedgers] = useState<GstLedgers>(EMPTY_GST_LEDGERS)
  const [pendingAllocations, setPendingAllocations] = useState<{
    bill_id: number; ref_no: string; ref_date: string | null; amount: string
  }[]>([])
  const altCLineUidRef = useRef<string | null>(null)
  const dateRef = useRef<HTMLInputElement>(null)
  // F2's target: the party picker on a party voucher, the Reference # box
  // otherwise. Neither takes a ref, so the page holds one on the wrapper and
  // resolves the focusable control out of it (see the effect below).
  const headerBoxRef = useRef<HTMLDivElement>(null)
  const headerFieldRef = useRef<HTMLInputElement | null>(null)
  // Which line the caret is in — Alt+D deletes THIS one. Kept in state and fed
  // by each row's onRowFocus rather than parsed back out of an element id:
  // rows are re-keyed on every insert and delete, ids are not.
  const [focusedLine, setFocusedLine] = useState(0)
  // ...and whether the caret is in the grid AT ALL. focusedLine is a remembered
  // position: on its own it would have Alt+D delete line 1 (its initial value)
  // while the caret sits in Date, the party picker, Narration or the save bar.
  // Tracked through React focus events on <tbody> rather than a DOM contains()
  // check, because the ledger dropdown is portalled to <body> yet is still a
  // child of its row in the React tree — so it counts as "in the grid" too.
  const caretInGrid = useRef(false)

  // ─── Initial load ──────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        // Mapping keys resolve the GST helper's ledgers to THIS store's own
        // Input/Output GST accounts (per-location overrides included).
        const [accs, gstRows] = await Promise.all([
          getChartOfAccounts(),
          getAllAccountMappingKeys({ location_id: (activeLocationId ?? 'null') as number | 'null' })
            .catch(() => []),
        ])
        if (!cancelled) {
          setAccounts(accs)
          const byKey: Record<string, number | null> = {}
          for (const r of gstRows) byKey[r.key] = r.account
          setGstLedgers({
            INPUT_CGST: byKey['INPUT_CGST'] ?? null,
            INPUT_SGST: byKey['INPUT_SGST'] ?? null,
            INPUT_IGST: byKey['INPUT_IGST'] ?? null,
            OUTPUT_CGST: byKey['OUTPUT_CGST'] ?? null,
            OUTPUT_SGST: byKey['OUTPUT_SGST'] ?? null,
            OUTPUT_IGST: byKey['OUTPUT_IGST'] ?? null,
          })
        }
      } catch { /* ignore */ }
      if (config.partyType) {
        try {
          const ps = config.partyType === 'Supplier' ? await getSuppliers() : await getCustomers()
          if (!cancelled) {
            setParties(ps)
            // Pre-select if ?party_id=… was passed (from PartyDetailPage quick action).
            if (initialPartyId && !editingId) {
              const p = ps.find((x) => x.id === initialPartyId)
              if (p) {
                setPartyId(p.id)
                if (narration === config.narrationTemplate) {
                  setNarration(`${config.narrationTemplate}${p.name}`)
                }
                if (autoOpenAlloc && voucherType === 'PAYMENT') {
                  setAllocOpen(true)
                }
              }
            }
          }
        } catch { /* ignore */ }
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
          setReferenceId(entry.reference_id ? String(entry.reference_id) : '')
          setNarration(entry.narration || '')
          setCostCenter(entry.cost_center || '')
          setCostCentreId(entry.cost_centre ?? null)
          setVoucherTypeProfileId(entry.voucher_type_profile ?? null)
          setLines(
            entry.lines.length > 0
              ? entry.lines.map((l): VoucherLine => {
                  const dr = parseFloat(l.debit) || 0
                  return {
                    uid: uid(),
                    side: dr > 0 ? 'Dr' : 'Cr',
                    account: l.account,
                    amount: dr > 0 ? l.debit : l.credit,
                    narration: l.narration || '',
                  }
                })
              : [makeLine(config.firstLineSide), makeLine(config.secondLineSide)]
          )
        } catch {
          toast.error('Failed to load voucher')
        }
      }
      if (!cancelled) setLoading(false)
    }
    load()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId, voucherType])

  // ─── Derived totals ────────────────────────────────────────────────────────
  const totals = useMemo(() => {
    let dr = 0, cr = 0
    for (const l of lines) {
      const amt = parseFloat(l.amount) || 0
      if (l.side === 'Dr') dr += amt
      else cr += amt
    }
    return { dr, cr, diff: dr - cr }
  }, [lines])

  // Compare on 2dp-rounded paisa — the backend posts 2dp Decimals, so a
  // float drift below half a paisa must not block (or fake) balance.
  const isBalanced =
    Math.round(totals.dr * 100) === Math.round(totals.cr * 100) && totals.dr > 0

  // ─── Line manipulation ─────────────────────────────────────────────────────
  function patchLine(uid: string, patch: Partial<VoucherLine>) {
    setLines((ls) => ls.map((l) => l.uid === uid ? { ...l, ...patch } : l))
  }
  function addLine() {
    setLines((ls) => {
      // alternate sides for convenience: copy last line's side flipped
      const last = ls[ls.length - 1]
      const next = last ? (last.side === 'Dr' ? 'Cr' : 'Dr') : 'Dr'
      return [...ls, makeLine(next)]
    })
  }
  function removeLine(uid: string) {
    setLines((ls) => ls.length <= 1 ? ls : ls.filter((l) => l.uid !== uid))
  }

  // ─── Focus plumbing for the line grid ──────────────────────────────────────
  /**
   * Hand focus on after a state change. A row that has just been added, or a
   * ledger that has just been chosen, only exists in the DOM on the next tick;
   * focusing before that silently lands on <body>.
   */
  const handOff = useCallback((focus: () => void) => { window.setTimeout(focus, 0) }, [])

  /** Focus (and select) one cell of a rendered line. */
  const focusLineCell = useCallback((rowIdx: number, col: string) => {
    handOff(() => {
      const el = document.getElementById(voucherLineCellId(rowIdx, col)) as HTMLInputElement | null
      el?.focus()
      el?.select?.()
    })
  }, [handOff])

  /** Focus the ledger trigger of a rendered line — the head of the row. */
  const focusLineAccount = useCallback((rowIdx: number) => {
    focusLineCell(rowIdx, 'account')
  }, [focusLineCell])

  /** Alt+A / Tab off the last cell — add a line and start keying it. */
  const appendLine = useCallback(() => {
    const nextIdx = lines.length
    addLine()
    setFocusedLine(nextIdx)
    focusLineAccount(nextIdx)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines.length, focusLineAccount])

  /**
   * Alt+D — drop the line the caret is in, then land on its neighbour.
   *
   * Refuses to act when the caret is not in the grid: the chord destroys a
   * line with no undo, and off the grid it would be acting on a stale
   * remembered row rather than on anything the user can see they are in.
   * Removing a line the user is looking at is announced, since a keyboard user
   * has no click target to tie the disappearance to.
   */
  const deleteFocusedLine = useCallback(() => {
    if (!caretInGrid.current) {
      toast.info('Alt+D removes the line the caret is in — press F3 to move into the lines first')
      return
    }
    if (lines.length <= 1) return
    const idx = Math.min(focusedLine, lines.length - 1)
    const target = lines[idx]?.uid
    if (!target) return
    setLines((ls) => ls.filter((l) => l.uid !== target))
    toast.success(`Line ${idx + 1} removed`)
    const next = Math.max(0, Math.min(idx, lines.length - 2))
    setFocusedLine(next)
    focusLineAccount(next)
  }, [lines, focusedLine, focusLineAccount])

  // ─── GST helper ─────────────────────────────────────────────────────────────
  // Prefill the taxable base from the largest existing line (usually the asset/
  // expense/income line the user just entered).
  const gstBasePrefill = useMemo(() => {
    let max = 0
    for (const l of lines) { const a = parseFloat(l.amount) || 0; if (a > max) max = a }
    return max > 0 ? String(max) : ''
  }, [lines])
  // Sales-type vouchers default to Output GST; everything else (incl. plain
  // Journal and Purchase) defaults to Input.
  const gstDefaultSide: GstSide =
    (voucherType === 'SALE' || voucherType === 'CREDIT_NOTE') ? 'output' : 'input'

  function handleGstInsert(newLines: GstInsertLine[]) {
    setLines((ls) => {
      // Drop the empty starter rows so the inserted GST lines aren't buried
      // under blanks; keep anything the user has touched.
      const kept = ls.filter((l) =>
        l.account != null || (l.amount && parseFloat(l.amount) > 0) || l.narration.trim())
      const additions = newLines.map((l): VoucherLine => ({
        uid: uid(), side: l.side, account: l.account,
        amount: l.amount, narration: l.narration,
      }))
      return [...kept, ...additions]
    })
    toast.success('GST lines added')
  }

  // ─── Save / post ───────────────────────────────────────────────────────────
  function payload() {
    const acctById = new Map(accounts.map((a) => [a.id, a]))
    const cleanLines = lines
      .filter((l) => l.account && parseFloat(l.amount) > 0)
      .map((l) => {
        const sub = acctById.get(l.account!)?.account_subtype
        // Attach the header party to receivable/payable lines so the backend
        // routes the generic Trade control to that party's own ledger (and the
        // line clears the party-required guard). Without this, a Credit/Debit
        // Note or Sale/Purchase posting to the bare 1130/2110 control 400'd
        // with no way for the user to fix it.
        const partyTag =
          config.partyType && partyId && (sub === 'Receivable' || sub === 'Payable')
            ? { party_type: config.partyType, party_id: Number(partyId) }
            : {}
        return {
          account: l.account!,
          debit: l.side === 'Dr' ? l.amount : '0',
          credit: l.side === 'Cr' ? l.amount : '0',
          narration: l.narration || '',
          ...partyTag,
        }
      })
    return {
      date,
      narration,
      voucher_type: voucherType,
      voucher_type_profile: voucherTypeProfileId,
      reference_type: 'Manual',
      reference_id: referenceId ? Number(referenceId) : null,
      cost_center: costCenter,
      cost_centre: costCentreId,
      location_id: activeLocationId as number,
      lines: cleanLines,
    }
  }

  function validate(): string | null {
    if (activeLocationId === null) return 'Switch to a specific store from the top-nav selector to record vouchers'
    const data = payload()
    if (data.lines.length < 2) return 'At least two lines are required'
    if (!isBalanced) return `Debit ${formatCurrency(totals.dr)} ≠ Credit ${formatCurrency(totals.cr)}`
    // A receivable/payable line needs a party so the backend can route it to
    // that party's ledger; otherwise it 400s on the generic Trade control.
    if (config.partyType && !partyId) {
      const acctById = new Map(accounts.map((a) => [a.id, a]))
      const hasPartyLine = lines.some((l) => {
        if (!l.account || !(parseFloat(l.amount) > 0)) return false
        const sub = acctById.get(l.account)?.account_subtype
        return sub === 'Receivable' || sub === 'Payable'
      })
      if (hasPartyLine) {
        return `Select a ${config.partyType.toLowerCase()} — the receivable/payable line must be tied to a party`
      }
    }
    // Header party vs per-party-ledger line: a line whose chosen account is
    // ANOTHER party's own ledger contradicts the header party. The backend would
    // reject it; catch it here with a clear message instead of a silent reroute.
    if (config.partyType && partyId) {
      const acctById = new Map(accounts.map((a) => [a.id, a]))
      for (const l of lines) {
        if (!l.account || !(parseFloat(l.amount) > 0)) continue
        const acc = acctById.get(l.account)
        if (acc?.party_id && Number(acc.party_id) !== Number(partyId)) {
          return `Line ledger "${acc.account_name}" belongs to a different ${config.partyType.toLowerCase()} than the one selected in the header — pick the matching ledger or change the party.`
        }
      }
    }
    return null
  }

  const allStores = activeLocationId === null

  const handleSave = useCallback(async function handleSave(thenPost = false) {
    const err = validate()
    if (err) { toast.error(err); return }
    setSaving(true)
    try {
      let entry: JournalEntry
      if (editingId) {
        entry = await updateJournalEntry(editingId, payload())
      } else {
        entry = await createJournalEntry(payload())
      }

      // Write Tally bill-wise allocations against the Dr line of the saved JE.
      if (pendingAllocations.length > 0 && entry.lines?.length > 0) {
        const drLine = entry.lines.find((l) => parseFloat(l.debit) > 0)
        if (drLine?.id) {
          for (const a of pendingAllocations) {
            try {
              await createBillReference({
                line: drLine.id,
                kind: 'AGAINST',
                ref_no: a.ref_no,
                ref_date: a.ref_date,
                amount: a.amount,
                bill_id: a.bill_id,
              })
            } catch { /* ignore individual ref errors so save still succeeds */ }
          }
          setPendingAllocations([])
        }
      }

      if (thenPost) {
        setPosting(true)
        try {
          await postEntry(entry.id)
          toast.success(`${entry.entry_no} posted`)
          // Tally users expect to land back on Gateway after posting.
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
            `${k}: ${flattenErrValue(v)}`).join(' • ')
        : 'Failed to save'
      toast.error(msg)
    } finally {
      setSaving(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, narration, voucherType, referenceId, activeLocationId, lines, editingId, costCenter, costCentreId, voucherTypeProfileId, pendingAllocations])

  // ─── Repeat last (Ctrl+H) ──────────────────────────────────────────────────
  const handleRepeatLast = useCallback(async () => {
    if (editingId) {
      toast.info('Ctrl+H only applies when creating a new voucher')
      return
    }
    try {
      const res = await getJournalEntries({
        voucher_type: voucherType,
        is_posted: 'true',
      })
      const last = res.results?.[0]
      if (!last) {
        toast.info(`No previous ${config.label} voucher to repeat`)
        return
      }
      setNarration(last.narration || '')
      setLines(
        last.lines.map((l): VoucherLine => {
          const dr = parseFloat(l.debit) || 0
          return {
            uid: uid(),
            side: dr > 0 ? 'Dr' : 'Cr',
            account: l.account,
            amount: dr > 0 ? l.debit : l.credit,
            narration: l.narration || '',
          }
        })
      )
      toast.success(`Repeated ${last.entry_no} (${last.date})`)
    } catch {
      toast.error('Failed to fetch previous voucher')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voucherType, editingId])

  // ─── Esc with confirm ──────────────────────────────────────────────────────
  const handleEsc = useCallback(() => {
    const dirty = lines.some((l) => l.account || l.amount)
      || (narration && narration !== config.narrationTemplate)
    if (dirty) {
      setEscConfirmOpen(true)
    } else {
      navigate('/')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, narration, navigate])

  // ─── Alt+C ledger create ───────────────────────────────────────────────────
  const handleAltCFromLine = useCallback((lineUid: string) => {
    altCLineUidRef.current = lineUid
    setCreateLedgerOpen(true)
  }, [])

  const handleAltCGlobal = useCallback(() => {
    altCLineUidRef.current = null
    setCreateLedgerOpen(true)
  }, [])

  function handleLedgerCreated(acc: Account) {
    setAccounts((prev) => [acc, ...prev])
    const target = altCLineUidRef.current
    if (target) {
      patchLine(target, { account: acc.id })
    }
  }

  function handleAllocation({ amount, narration: alloc, items }: {
    amount: string; narration: string; billIds: number[];
    items: { bill_id: number; ref_no: string; ref_date: string | null; amount: string }[]
  }) {
    // Mirror the allocation amount onto the first Dr and first Cr lines, so
    // both sides balance to the bill total. Anything beyond two lines stays.
    let drSet = false
    let crSet = false
    setLines((ls) => ls.map((l) => {
      if (l.side === 'Dr' && !drSet) { drSet = true; return { ...l, amount } }
      if (l.side === 'Cr' && !crSet) { crSet = true; return { ...l, amount } }
      return l
    }))
    setNarration(alloc)
    setPendingAllocations(items)
  }

  // ─── Line grid keyboard model ──────────────────────────────────────────────
  const grid = useGridKeyboardNav({
    rowCount: lines.length,
    columnIds: VOUCHER_LINE_COLUMNS,
    buildCellId: voucherLineCellId,
    // Tab off the last cell, and Enter on the last row, both grow the voucher —
    // a clerk keys line after line without pausing to click "Add line".
    onAppendRow: addLine,
    onEnterAppendRow: addLine,
  })

  /**
   * Cell movement for one line, forwarded by VoucherLineRow from its narration
   * and amount fields (the ledger cell is a picker that owns its own keys).
   *
   * Tab keeps its natural left-to-right order — that is what keeps each row's
   * delete button in reach — and only the last cell of the last line overrides
   * it, to grow the voucher. That override is gated on the last line having
   * something in it: ungated, Tab off the freshly appended blank row appends
   * another one, so forward Tab could never leave the grid and the Narration
   * box and the save bar below it were unreachable without Shift+Tab. With the
   * gate, the trailing blank line always tabs through to the row's delete
   * button and on out of the table.
   */
  const lineKeyDown = useCallback((e: React.KeyboardEvent, rowIdx: number, colId: string) => {
    const last = lines[lines.length - 1]
    const lastKeyed = !!last
      && (last.account != null || !!last.narration.trim() || parseFloat(last.amount) > 0)
    const growCell = colId === 'amount' && rowIdx === lines.length - 1 && lastKeyed
    if (e.key === 'Tab' && (e.shiftKey || !growCell)) return
    grid.handleKeyDown(e, rowIdx, colId)
  }, [grid, lines])

  /**
   * Alt+G is not in lib/shortcuts' GLOBAL_ALLOW_LIST (that list is shared), so
   * the document-level dispatcher drops it while focus is in a field — which,
   * on a voucher, is nearly always. Catching it on the page root gets the GST
   * helper from anywhere on the screen; the registration below is what puts it
   * in the hint bar and the F1 catalogue.
   *
   * Because it is a bespoke root handler it never reaches HotkeyContext, so the
   * overlay-depth gate that holds page chords back behind a dialog does not
   * cover it — and every overlay this screen owns (the Esc confirm, the ledger
   * modal, the cost-centre popup, the bill-allocation sheet) is a React child
   * of this div, so keystrokes inside them bubble to here even though they are
   * portalled away in the DOM. Alt+G in any of them stacked the GST helper on
   * top of the dialog the user was in.
   *
   * So apply the same gate by hand. This handler sits on the page root, i.e.
   * overlay depth 0, and HotkeyContext skips a handler shallower than the
   * number of open overlays — for depth 0 that means "one open overlay is
   * enough". The marker queried here is the one openOverlayCount() reads, and
   * every overlay on this screen sets it, the GST popup included (bespoke
   * portal though it is), so re-opening it over itself is covered too.
   */
  const onPageKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.defaultPrevented || !e.altKey || e.ctrlKey || e.metaKey) return
    if (e.key.toLowerCase() !== 'g') return
    if (document.querySelector('[role="dialog"][data-state="open"]')) return
    e.preventDefault()
    setGstOpen(true)
  }, [])

  // ─── Hotkey wiring ─────────────────────────────────────────────────────────
  /**
   * Escape runs through usePageKeyboard → useEscapeBack, which leaves a focused
   * field first and stands down while a dialog owns the key. The old raw
   * 'Escape' chord fired through both, so dismissing a ledger dropdown also
   * abandoned the voucher behind it. `backActive` covers the GST popup too —
   * it is a bespoke portal, not a Radix dialog, so useEscapeBack cannot see it.
   */
  const canSave = !saving && !posting && !allStores
  usePageKeyboard({
    actions: [
      { chord: 'Ctrl+S', label: 'Save Draft', run: () => handleSave(false), when: canSave },
      { chord: 'Ctrl+A', label: 'Save & Post', run: () => handleSave(true), when: canSave },
      // The F1 sheet documents Ctrl+Enter for save-and-post; bind it as an
      // alias rather than a second bar entry saying the same thing.
      { chord: 'Ctrl+Enter', label: 'Save & Post', run: () => handleSave(true), when: canSave, hidden: true },
      { chord: 'Alt+A', label: 'Add Line', run: appendLine },
      { chord: 'Alt+D', label: 'Delete Line', run: deleteFocusedLine, when: lines.length > 1 },
      { chord: 'Alt+C', label: 'New Ledger', run: handleAltCGlobal },
      { chord: 'Alt+G', label: 'GST', run: () => setGstOpen(true) },
      { chord: 'Ctrl+H', label: 'Repeat Last', run: handleRepeatLast, when: !editingId },
      { chord: 'Ctrl+L', label: 'Cost Centre', run: () => setCostCenterOpen(true) },
    ],
    searchRef: headerFieldRef,
    onFocusList: () => focusLineAccount(Math.min(focusedLine, Math.max(0, lines.length - 1))),
    onBack: handleEsc,
    backActive: !gstOpen,
  })

  /**
   * Resolve F2's target out of the header slot — the party picker's trigger on
   * a party voucher, the Reference # box otherwise. Re-run on every render:
   * which control sits there depends on state, and neither takes a ref.
   */
  useEffect(() => {
    if (loading) return
    headerFieldRef.current =
      (headerBoxRef.current?.querySelector('input, button') as HTMLInputElement | null) ?? null
  })

  /**
   * PageTransition's [data-autofocus] pass runs while this route is still a
   * spinner, so it finds nothing to focus. Repeat it once the form exists, so
   * F4/F7 land on the Date field instead of on <body>.
   */
  useEffect(() => {
    if (loading) return
    const el = dateRef.current
    if (!el) return
    const raf = requestAnimationFrame(() => el.focus())
    return () => cancelAnimationFrame(raf)
  }, [loading])

  // ─── Render ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="p-12 text-center">
        <Loader2 className="animate-spin inline" size={24} style={{ color: 'var(--brand)' }} />
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto space-y-4 pb-32" onKeyDown={onPageKeyDown}>
      <button
        onClick={handleEsc}
        className="inline-flex items-center gap-1 text-sm hover:opacity-80 mb-1"
        style={{ color: 'var(--ink-2)' }}
      >
        <ArrowLeft size={14} /> Gateway
      </button>

      {allStores && (
        <div
          className="mb-3 px-4 py-2.5 rounded-lg flex flex-wrap items-center gap-2.5 text-sm"
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
            {config.fKey}
          </span>
          <h1 className="text-lg sm:text-xl font-semibold" style={{ color: 'var(--ink)', letterSpacing: '-0.01em' }}>
            {editingId ? `Edit ${originalEntry?.entry_no ?? config.label}` : `${config.label} Voucher`}
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
          <span className="text-sm" style={{ color: 'var(--ink-2)' }}>· {config.description}</span>
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
        <div className="flex flex-wrap items-center gap-2">
          {voucherType === 'PAYMENT' && partyId && (
            <Button variant="secondary" size="sm" onClick={() => setAllocOpen(true)}>
              <FileStack size={14} /> Allocate Bills
            </Button>
          )}
          {!costCenter && !costCentreId && (
            <Button variant="ghost" size="sm" chord="Ctrl+L" onClick={() => setCostCenterOpen(true)}>
              <Layers size={14} /> Cost Centre
            </Button>
          )}
          {originalEntry && <Badge variant="warning">Draft</Badge>}
        </div>
      </div>

      <Card className="p-4 sm:p-5">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <Field label="Date" required>
            <Input ref={dateRef} data-autofocus type="date" required value={date}
              onChange={(e) => setDate(e.target.value)} />
          </Field>
          {/* F2's target. The wrapper is how the page reaches whichever
              control this slot renders — neither of them takes a ref. */}
          <div ref={headerBoxRef}>
            {config.partyType ? (
              <Field label={config.partyType} hint="Type letters to narrow · ↑↓ Enter · F2 to jump here">
                <PartySearchPicker
                  parties={parties}
                  ariaLabel={config.partyType}
                  value={partyId}
                  onChange={(id) => {
                    setPartyId(id)
                    if (id) {
                      const p = parties.find((x) => x.id === Number(id))
                      if (p && narration === config.narrationTemplate) {
                        setNarration(`${config.narrationTemplate}${p.name}`)
                      }
                    }
                  }}
                  storageKey={config.partyType}
                  placeholder={`Search ${config.partyType.toLowerCase()}…`}
                />
              </Field>
            ) : (
              <Field label="Reference #" hint="Optional · F2 to jump here">
                <Input value={referenceId} onChange={(e) => setReferenceId(e.target.value)} />
              </Field>
            )}
          </div>
          <Field label="Voucher Type">
            <Input
              value={config.label} readOnly
              style={{ backgroundColor: 'var(--surface-1)', color: 'var(--ink-2)' }}
            />
          </Field>
        </div>
      </Card>

      <Card className="overflow-hidden p-0">
        <div
          className="px-4 sm:px-5 py-3 border-b flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between"
          style={{ borderColor: 'var(--line)' }}
        >
          <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>Particulars</h2>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs" style={{ color: 'var(--ink-2)' }}>
            <span>By = Dr · To = Cr</span>
            <span>·</span>
            <span>Total Dr & Cr must match</span>
          </div>
        </div>
        <div className="table-scroll">
          {/* The line grid keeps its Tally column layout on every screen — it
              scrolls sideways rather than reflowing into stacked cards. */}
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-b" style={{ background: 'var(--surface-1)', borderColor: 'var(--line)' }}>
              <tr>
                <th className="text-left text-[10px] font-semibold px-2 py-2 uppercase tracking-wide w-20" style={{ color: 'var(--ink-2)' }}>By/To</th>
                <th className="text-left text-[10px] font-semibold px-2 py-2 uppercase tracking-wide" style={{ width: '32%', color: 'var(--ink-2)' }}>Particulars (Ledger)</th>
                <th className="text-left text-[10px] font-semibold px-2 py-2 uppercase tracking-wide" style={{ color: 'var(--ink-2)' }}>Narration</th>
                <th className="text-right text-[10px] font-semibold px-2 py-2 uppercase tracking-wide w-36" style={{ color: 'var(--ink-2)' }}>Amount</th>
                <th className="w-8" />
              </tr>
            </thead>
            {/* React focus events, so the ledger dropdown — portalled to
                <body>, still a child of its row in the React tree — counts as
                being in the grid. focusout fires before focusin, so moving
                between cells clears and re-sets the flag with no keystroke in
                between. */}
            <tbody
              onFocus={() => { caretInGrid.current = true }}
              onBlur={() => { caretInGrid.current = false }}
            >
              {lines.map((line, i) => (
                <VoucherLineRow
                  key={line.uid}
                  line={line}
                  rowIdx={i}
                  accounts={accounts}
                  accountFilter={config.accountFilter}
                  onChange={(p) => {
                    patchLine(line.uid, p)
                    // Ledger chosen → carry on along the row, straight to the
                    // figure that goes with it.
                    if (p.account != null) focusLineCell(i, 'amount')
                  }}
                  onCellKeyDown={(e, colId) => lineKeyDown(e, i, colId)}
                  // Alt+D deletes the line the caret is in, so the grid has to
                  // remember which one that is.
                  onRowFocus={() => setFocusedLine(i)}
                  onRemove={() => removeLine(line.uid)}
                  onAltC={handleAltCFromLine}
                  removeDisabled={lines.length <= 1}
                />
              ))}
            </tbody>
            <tfoot className="border-t" style={{ background: 'var(--surface-1)', borderColor: 'var(--line)' }}>
              <tr>
                <td className="px-2 py-2" colSpan={2}>
                  <div className="flex items-center gap-4">
                    <button
                      type="button"
                      onClick={appendLine}
                      aria-keyshortcuts="Alt+A"
                      className="inline-flex items-center gap-1.5 text-sm hover:opacity-90"
                      style={{ color: 'var(--brand)' }}
                    >
                      <Plus size={14} /> Add line
                      <kbd className="hidden md:inline mono text-[10px]" style={{ color: 'var(--ink-3)' }}>Alt+A</kbd>
                    </button>
                    <button
                      type="button"
                      onClick={() => setGstOpen(true)}
                      aria-keyshortcuts="Alt+G"
                      className="inline-flex items-center gap-1.5 text-sm hover:opacity-90"
                      style={{ color: 'var(--brand)' }}
                      title="Auto-fill CGST/SGST or IGST lines from a taxable amount (Alt+G)"
                    >
                      <Calculator size={14} /> GST
                      <kbd className="hidden md:inline mono text-[10px]" style={{ color: 'var(--ink-3)' }}>Alt+G</kbd>
                    </button>
                  </div>
                </td>
                <td className="px-2 py-2 text-right text-xs" style={{ color: 'var(--ink-2)' }}>
                  Total
                </td>
                <td className="px-2 py-2 text-right">
                  <div className="flex flex-col items-end gap-0.5">
                    <span className="font-mono text-sm font-semibold" style={{ color: 'var(--ink)' }}>
                      Dr {formatCurrency(totals.dr)}
                    </span>
                    <span className="font-mono text-sm font-semibold" style={{ color: 'var(--ink)' }}>
                      Cr {formatCurrency(totals.cr)}
                    </span>
                  </div>
                </td>
                <td />
              </tr>
              <tr>
                <td colSpan={5} className="px-4 py-2 text-right">
                  {/* A keyboard user never sees the totals move, so the balance
                      state has to be announced, not only coloured. */}
                  <span role="status" aria-live="polite">
                    {totals.dr > 0 && !isBalanced ? (
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium" style={{ color: 'var(--danger)' }}>
                        Difference {formatCurrency(Math.abs(totals.diff))}
                      </span>
                    ) : isBalanced ? (
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium" style={{ color: 'var(--success)' }}>
                        <Check size={12} /> Balanced
                      </span>
                    ) : (
                      <span className="text-xs" style={{ color: 'var(--ink-3)' }}>
                        Enter amounts to balance
                      </span>
                    )}
                  </span>
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

      {/* Sticky save bar — sits on the F-key bar at md+, on the viewport floor
          below it, where the F-key bar is hidden. */}
      <div
        className="fixed left-0 right-0 bottom-0 md:bottom-9 z-20 px-3 sm:px-6 py-3 flex flex-wrap items-center justify-end gap-2 safe-bottom"
        style={{
          background: 'var(--surface-0)',
          borderTop: '1px solid var(--line)',
          boxShadow: '0 -4px 12px rgba(0,0,0,0.04)',
        }}
      >
        <Button variant="ghost" chord="Ctrl+H" onClick={handleRepeatLast} disabled={!!editingId}>
          <History size={14} /> <span className="hidden sm:inline">Repeat Last</span>
        </Button>
        <Button variant="secondary" chord="Esc" onClick={handleEsc}>
          Cancel
        </Button>
        <Button variant="secondary" chord="Ctrl+S" onClick={() => handleSave(false)} disabled={saving || posting || allStores}>
          {saving && !posting ? <Loader2 className="animate-spin" size={14} /> : <Save size={14} />}
          Save Draft
        </Button>
        {/* Disabled while unbalanced, as it has always been — an out-of-balance
            voucher cannot post. The keyboard path is not lost with it: Ctrl+A
            stays bound (see canSave) and routes through validate(), which
            toasts the exact Dr/Cr difference instead of going quiet. */}
        <Button chord="Ctrl+A" onClick={() => handleSave(true)} disabled={saving || posting || !isBalanced || allStores}>
          {posting ? <Loader2 className="animate-spin" size={14} /> : <Send size={14} />}
          Save & Post
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

      {voucherType === 'PAYMENT' && partyId && (
        <BillAllocationSheet
          open={allocOpen}
          onOpenChange={setAllocOpen}
          vendorId={Number(partyId)}
          vendorName={parties.find((p) => p.id === Number(partyId))?.name || ''}
          onAllocate={handleAllocation}
        />
      )}

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

      <GstHelperPopup
        open={gstOpen}
        onOpenChange={setGstOpen}
        accounts={accounts}
        ledgers={gstLedgers}
        defaultSide={gstDefaultSide}
        basePrefill={gstBasePrefill}
        onInsert={handleGstInsert}
      />
    </div>
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
