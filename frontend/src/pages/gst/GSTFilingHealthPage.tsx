import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, Info, Loader2, RefreshCw, ShieldAlert } from 'lucide-react'
import { toast } from 'sonner'
import { getGSTFilingHealth, type FilingHealthReport, type FilingHealthSection } from '../../lib/api'
import { getCurrentPeriod } from '../../lib/utils'
import { Button } from '../../components/ui/button'
import { PeriodPicker } from '../../components/ui/period-picker'
import { Card } from '../../components/ui/card'
import { usePageKeyboard } from '../../hooks/usePageKeyboard'
import { useListKeyboardNav } from '../../hooks/useListKeyboardNav'
import { useLocation } from '../../contexts/LocationContext'

const SEVERITY_STYLE: Record<string, { bg: string; fg: string; Icon: typeof Info }> = {
  error: { bg: '#fef2f2', fg: '#b91c1c', Icon: ShieldAlert },
  warning: { bg: '#fffbeb', fg: '#b45309', Icon: AlertTriangle },
  info: { bg: '#f0f9ff', fg: '#0369a1', Icon: Info },
}

/** The exact prop bag useListKeyboardNav hands each row. */
type RowProps = ReturnType<ReturnType<typeof useListKeyboardNav>['rowProps']>

interface SectionCardProps {
  section: FilingHealthSection
  /** Lifted to the page so one key can open/close the section the user is on. */
  open: boolean
  onToggle: () => void
  panelId: string
  rowProps: RowProps
}

function SectionCard({ section, open, onToggle, panelId, rowProps }: SectionCardProps) {
  const sev = SEVERITY_STYLE[section.severity] ?? SEVERITY_STYLE.info
  const clean = section.status === 'ok' && section.count === 0
  const columns = section.rows.length > 0 ? Object.keys(section.rows[0]) : []
  const expandable = section.rows.length > 0

  return (
    <Card className="overflow-hidden">
      {/*
        The header used to be a bare <div onClick>: the offending invoices —
        the whole point of the screen — were behind a mouse click and nothing
        else. rowProps supplies the role, the roving tabIndex and the
        Enter/Space handler, so this is a real button to the keyboard and to a
        screen reader without becoming one more Tab stop per section.
      */}
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer"
        onClick={() => expandable && onToggle()}
        aria-expanded={expandable ? open : undefined}
        aria-controls={expandable && open ? panelId : undefined}
        aria-disabled={expandable ? undefined : true}
        {...rowProps}
      >
        {clean ? (
          <CheckCircle2 size={18} className="text-emerald-600 shrink-0" />
        ) : (
          <sev.Icon size={18} style={{ color: sev.fg }} className="shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium" style={{ color: 'var(--ink)' }}>{section.title}</div>
          <div className="text-xs mt-0.5" style={{ color: 'var(--ink-2)' }}>{section.note}</div>
        </div>
        {section.status === 'unavailable' ? (
          <span className="text-[11px] px-2 py-0.5 rounded bg-slate-100 text-slate-500 shrink-0">unavailable</span>
        ) : (
          <span
            className="text-xs font-semibold px-2.5 py-1 rounded-full shrink-0"
            style={clean ? { backgroundColor: '#ecfdf5', color: '#047857' }
              : { backgroundColor: sev.bg, color: sev.fg }}
          >
            {clean ? 'Clean' : `${section.count} found`}
          </span>
        )}
      </div>
      {open && section.rows.length > 0 && (
        // The detail table scrolls sideways, so the rail is a focusable region:
        // otherwise its right-hand columns are unreachable without a pointer.
        <div
          id={panelId}
          className="border-t table-scroll"
          style={{ borderColor: 'var(--line)' }}
          tabIndex={0}
          role="region"
          aria-label={`${section.title} — offending rows`}
        >
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50" style={{ color: 'var(--ink-2)' }}>
                {columns.map((c) => (
                  <th key={c} className="text-left px-3 py-2 font-medium whitespace-nowrap">
                    {c.replace(/_/g, ' ')}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {section.rows.map((r, i) => (
                <tr key={i} className="border-t" style={{ borderColor: 'var(--line)' }}>
                  {columns.map((c) => (
                    <td key={c} className="px-3 py-1.5 font-mono whitespace-nowrap" style={{ color: 'var(--ink)' }}>
                      {String(r[c] ?? '—')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {section.count > section.rows.length && (
            <div className="px-3 py-2 text-[11px]" style={{ color: 'var(--ink-3)' }}>
              Showing first {section.rows.length} of {section.count}.
            </div>
          )}
        </div>
      )}
    </Card>
  )
}

export default function GSTFilingHealthPage() {
  const navigate = useNavigate()
  const [data, setData] = useState<FilingHealthReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [period, setPeriod] = useState(getCurrentPeriod())
  // Which sections are open, keyed by title — lifted out of SectionCard so the
  // page-level row cursor can toggle the section the user is standing on.
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({})
  const { activeLocationId } = useLocation()

  // PeriodPicker forwards its ref to the MONTH select — the entry point of the
  // pair. That element is both the F2 target and what PageTransition focuses on
  // arrival, since the period is the only input on this screen.
  // usePageKeyboard only calls focus()/select?.(), both safe on a <select>.
  const periodRef = useRef<HTMLInputElement | null>(null)
  const bindPeriod = useCallback((el: HTMLSelectElement | null) => {
    el?.setAttribute('data-autofocus', '')
    periodRef.current = el as unknown as HTMLInputElement | null
  }, [])

  async function load() {
    setLoading(true)
    try {
      setData(await getGSTFilingHealth(period))
    } catch {
      toast.error('Failed to run filing health check')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { if (period) load() }, [period, activeLocationId])

  const sections = data ? Object.values(data.sections) : []
  const order = { error: 0, warning: 1, info: 2 }
  sections.sort((a, b) => (order[a.severity] ?? 3) - (order[b.severity] ?? 3))

  const toggleSection = useCallback((title: string) => {
    setOpenSections((prev) => ({ ...prev, [title]: !prev[title] }))
  }, [])

  // ─── Keyboard ──────────────────────────────────────────────────────────────
  // ↑↓ walk the section cards (errors first), Enter/Space opens the one under
  // the cursor. F3 jumps here from the period picker.
  const list = useListKeyboardNav({
    count: sections.length,
    onActivate: (i) => {
      const s = sections[i]
      if (s && s.rows.length > 0) toggleSection(s.title)
    },
  })

  usePageKeyboard({
    actions: [
      { chord: 'Alt+R', label: 'Re-run check', run: load, when: !loading },
    ],
    searchRef: periodRef,
    onFocusList: list.focusList,
    onBack: () => navigate(-1),
  })

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      <div className="mb-6">
        <h1 className="text-lg sm:text-xl font-semibold" style={{ color: 'var(--ink)', letterSpacing: '-0.01em' }}>
          GST Filing Health Check
        </h1>
        <p className="text-sm mt-0.5" style={{ color: 'var(--ink-2)' }}>
          Pre-filing scan — data problems that would get GSTR-1/3B rejected, put ITC at
          risk, or invite notices (HSN, GSTIN, §17(5)(h) reversals, §194Q TDS).
        </p>
      </div>

      <div className="flex items-center gap-2 sm:gap-3 mb-5 flex-wrap">
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-500 font-medium">Period</label>
          <PeriodPicker ref={bindPeriod} value={period} onChange={setPeriod} label="Filing health period" />
        </div>
        {/* Alt+R re-runs the scan, but the only evidence of that was the hint
            bar: nothing on the screen said the check could be run again and
            there was nothing to Tab to. The chord and the control are the same
            action — a plain GET, so no confirmation is owed. */}
        <Button variant="secondary" onClick={load} disabled={loading}>
          {loading ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
          Re-run check
        </Button>
        {data && (
          <span
            className="ml-auto text-xs font-semibold px-3 py-1.5 rounded-full"
            style={data.total_issues === 0
              ? { backgroundColor: '#ecfdf5', color: '#047857' }
              : { backgroundColor: '#fef2f2', color: '#b91c1c' }}
          >
            {data.total_issues === 0 ? 'Ready to file' : `${data.total_issues} actionable issues`}
          </span>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={28} className="animate-spin text-teal-600" />
        </div>
      ) : !data ? (
        <Card className="p-8 sm:p-12 text-center text-slate-400 text-sm">Select a period to run the check</Card>
      ) : (
        <div className="flex flex-col gap-3" {...list.containerProps}>
          {sections.map((s, i) => (
            <SectionCard
              key={s.title}
              section={s}
              open={!!openSections[s.title]}
              onToggle={() => toggleSection(s.title)}
              panelId={`filing-health-panel-${i}`}
              rowProps={list.rowProps(i)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
