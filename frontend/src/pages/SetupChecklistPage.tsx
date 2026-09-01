import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CheckCircle2, AlertTriangle, ChevronRight, Loader2, Settings as SettingsIcon } from 'lucide-react'
import {
  getSettings, getAccountMappings, getBankAccounts,
  type AccountingSettings, type AccountMapping, type BankAccount,
} from '../lib/api'
import { Card } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { usePageKeyboard } from '../hooks/usePageKeyboard'
import { useListKeyboardNav } from '../hooks/useListKeyboardNav'

interface CheckItem {
  id: string
  label: string
  description: string
  ok: boolean
  detail?: string
  fix?: { label: string; to: string }
  required: boolean
}

const REQUIRED_MAPPING_KEYS = [
  'CASH', 'BANK', 'TRADE_RECEIVABLES', 'TRADE_PAYABLES',
  'PURCHASES', 'SALES_POS', 'SALES_B2B',
  'INPUT_CGST', 'INPUT_SGST', 'INPUT_IGST',
  'OUTPUT_CGST', 'OUTPUT_SGST', 'OUTPUT_IGST',
  'RETAINED_EARNINGS', 'ROUND_OFF',
]

export default function SetupChecklistPage() {
  const navigate = useNavigate()
  const [settings, setSettings] = useState<AccountingSettings | null>(null)
  const [mappings, setMappings] = useState<AccountMapping[]>([])
  const [banks, setBanks] = useState<BankAccount[]>([])
  const [loading, setLoading] = useState(true)

  // Extracted so Alt+R can re-run the same three fetches the mount effect does
  // — a checklist you cannot re-check after fixing something is half a tool.
  const load = useCallback(() => {
    let cancelled = false
    // Deliberately no setLoading(true): an Alt+R re-check swaps the whole list
    // for a spinner if it does, and the focused row — with it, the keyboard
    // user's place in the checklist — goes to <body>.
    Promise.all([getSettings(), getAccountMappings(), getBankAccounts().catch(() => [])])
      .then(([s, m, b]) => {
        if (cancelled) return
        setSettings(s)
        setMappings(m)
        setBanks(Array.isArray(b) ? b : [])
      })
      .catch(() => { /* ignore */ })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => load(), [load])

  const checks = useMemo<CheckItem[]>(() => {
    if (!settings) return []
    const mappedKeys = new Set(mappings.map((m) => m.key))
    const missingMappings = REQUIRED_MAPPING_KEYS.filter((k) => !mappedKeys.has(k))
    return [
      {
        id: 'company',
        label: 'Company name',
        description: 'Used on printed vouchers and reports',
        ok: !!settings.company_name?.trim(),
        detail: settings.company_name,
        fix: { label: 'Open Settings', to: '/settings' },
        required: true,
      },
      {
        id: 'gstin',
        label: 'GSTIN',
        description: 'Required for GST returns and e-invoices',
        ok: !!settings.gstin?.trim() && settings.gstin.length >= 15,
        detail: settings.gstin,
        fix: { label: 'Open Settings', to: '/settings' },
        required: true,
      },
      {
        id: 'pan',
        label: 'PAN',
        description: 'Required for TDS and TCS returns',
        ok: !!settings.pan?.trim(),
        detail: settings.pan,
        fix: { label: 'Open Settings', to: '/settings' },
        required: true,
      },
      {
        id: 'tan',
        label: 'TAN',
        description: 'Required if you deduct TDS',
        ok: !!settings.tan?.trim(),
        detail: settings.tan,
        fix: { label: 'Open Settings', to: '/settings' },
        required: false,
      },
      {
        id: 'state',
        label: 'State code',
        description: 'Drives intra/inter-state GST calculations',
        ok: !!settings.state_code?.trim(),
        detail: settings.state_code,
        fix: { label: 'Open Settings', to: '/settings' },
        required: true,
      },
      {
        id: 'address',
        label: 'Registered address',
        description: 'Printed on invoices',
        ok: !!settings.registered_address?.trim(),
        fix: { label: 'Open Settings', to: '/settings' },
        required: false,
      },
      {
        id: 'fy',
        label: 'Financial year start',
        description: 'India fiscal year (default 1 April)',
        ok: !!settings.financial_year_start,
        // financial_year_start is a month number (1-12) — show the name.
        detail: settings.financial_year_start
          ? new Date(2000, settings.financial_year_start - 1, 1)
              .toLocaleString('en', { month: 'long' })
          : undefined,
        fix: { label: 'Open Settings', to: '/settings' },
        required: true,
      },
      {
        id: 'mappings',
        label: 'Account mappings',
        description: missingMappings.length === 0
          ? `All ${REQUIRED_MAPPING_KEYS.length} required mappings are set`
          : `${missingMappings.length} mapping(s) missing: ${missingMappings.slice(0, 4).join(', ')}${missingMappings.length > 4 ? '…' : ''}`,
        ok: missingMappings.length === 0,
        fix: { label: 'Open Settings', to: '/settings' },
        required: true,
      },
      {
        id: 'banks',
        label: 'Bank accounts',
        description: 'At least one bank account configured for payments/receipts',
        ok: banks.length > 0,
        detail: `${banks.length} configured`,
        fix: { label: 'Open Banking', to: '/banking' },
        required: true,
      },
    ]
  }, [settings, mappings, banks])

  const required = checks.filter((c) => c.required)
  const optional = checks.filter((c) => !c.required)
  const requiredOk = required.filter((c) => c.ok).length
  const requiredTotal = required.length
  const allRequiredDone = requiredOk === requiredTotal && requiredTotal > 0

  // ─── Keyboard ─────────────────────────────────────────────────────────────
  // The rows are the screen's real content, so they are what F3 jumps into and
  // what Enter acts on — including the passing ones, which previously exposed
  // no control at all and so could not be opened from the keyboard.
  const requiredNav = useListKeyboardNav({
    count: required.length,
    onActivate: (i) => { const f = required[i]?.fix; if (f) navigate(f.to) },
  })
  const optionalNav = useListKeyboardNav({
    count: optional.length,
    onActivate: (i) => { const f = optional[i]?.fix; if (f) navigate(f.to) },
  })

  // F11 is NOT registered here: it is a global chord that navigates to /setup,
  // and this screen IS /setup, so advertising it promised a key that reloads
  // nothing. Esc now has a real handler rather than only a hint.
  usePageKeyboard({
    actions: [
      { chord: 'Alt+S', label: 'Settings', run: () => navigate('/settings') },
      { chord: 'Alt+R', label: 'Re-check', run: load },
    ],
    onFocusList: requiredNav.focusList,
    onBack: () => navigate(-1),
  })

  if (loading || !settings) {
    return <div className="p-12 text-center"><Loader2 className="animate-spin inline" size={24} style={{ color: 'var(--brand)' }} /></div>
  }

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-baseline gap-3">
          <span
            className="mono text-xs font-bold px-2 py-0.5 rounded hidden md:inline"
            style={{
              background: 'rgba(15,157,154,0.12)',
              color: 'var(--brand)',
              border: '1px solid rgba(15,157,154,0.25)',
            }}
          >
            F11
          </span>
          <h1 className="text-lg sm:text-xl font-semibold" style={{ color: 'var(--ink)', letterSpacing: '-0.01em' }}>
            Setup Checklist
          </h1>
        </div>
        <Button variant="secondary" className="flex-shrink-0" onClick={() => navigate('/settings')}>
          <SettingsIcon size={14} /> Settings
        </Button>
      </div>

      <Card className="p-4 sm:p-5">
        <div className="flex items-center gap-3">
          {allRequiredDone ? (
            <>
              <div
                className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ background: 'rgba(31,138,76,0.12)' }}
              >
                <CheckCircle2 size={20} style={{ color: 'var(--success)' }} />
              </div>
              <div className="min-w-0">
                <div className="font-semibold" style={{ color: 'var(--ink)' }}>
                  All required setup complete
                </div>
                <div className="text-sm" style={{ color: 'var(--ink-2)' }}>
                  Your books are ready to record vouchers and generate returns.
                </div>
              </div>
            </>
          ) : (
            <>
              <div
                className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ background: 'rgba(199,122,17,0.12)' }}
              >
                <AlertTriangle size={20} style={{ color: 'var(--warning)' }} />
              </div>
              <div className="min-w-0">
                <div className="font-semibold" style={{ color: 'var(--ink)' }}>
                  {requiredOk}/{requiredTotal} required steps done
                </div>
                <div className="text-sm" style={{ color: 'var(--ink-2)' }}>
                  Complete the remaining items below for accurate filings.
                </div>
              </div>
            </>
          )}
          <div className="flex-1" />
          <div className="text-2xl font-semibold mono flex-shrink-0" style={{ color: 'var(--brand)' }}>
            {Math.round((requiredOk / Math.max(requiredTotal, 1)) * 100)}%
          </div>
        </div>
      </Card>

      <SectionList title="Required" items={required} navigate={navigate} nav={requiredNav} />
      <SectionList title="Optional" items={optional} navigate={navigate} nav={optionalNav} />
    </div>
  )
}

function SectionList({ title, items, navigate, nav }: {
  title: string
  items: CheckItem[]
  navigate: (to: string) => void
  nav: ReturnType<typeof useListKeyboardNav>
}) {
  if (items.length === 0) return null
  return (
    <div>
      <h2
        className="mono uppercase text-[11px] font-semibold tracking-wider mb-2"
        style={{ color: 'var(--ink-3)' }}
      >
        {title}
      </h2>
      <Card className="p-0 overflow-hidden">
        <ul {...nav.containerProps}>
          {items.map((c, i) => (
            <li
              key={c.id}
              className={i < items.length - 1 ? 'border-b' : ''}
              style={i < items.length - 1 ? { borderColor: 'var(--line)' } : undefined}
            >
              {/* The row itself is the activation target — one tab stop for the
                  whole list, ↑↓ between items, Enter opens the fix. */}
              <div
                className="flex items-center gap-3 px-3 sm:px-4 py-3 focus:outline-none"
                aria-label={`${c.label} — ${c.ok ? 'done' : 'needs attention'}`}
                {...nav.rowProps(i)}
              >
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
                  style={{
                    background: c.ok ? 'rgba(31,138,76,0.10)' : 'rgba(199,122,17,0.10)',
                  }}
                >
                  {c.ok ? (
                    <CheckCircle2 size={14} style={{ color: 'var(--success)' }} />
                  ) : (
                    <AlertTriangle size={14} style={{ color: 'var(--warning)' }} />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium" style={{ color: 'var(--ink)' }}>
                    {c.label}
                  </div>
                  <div className="text-xs" style={{ color: 'var(--ink-2)' }}>
                    {c.detail || c.description}
                  </div>
                </div>
                {c.fix && !c.ok && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="flex-shrink-0 whitespace-nowrap"
                    // tabIndex={-1}: the row that contains it is already the
                    // single tab stop and Enter on it runs this same navigate,
                    // so leaving the button tabbable would double every stop.
                    tabIndex={-1}
                    onClick={() => navigate(c.fix!.to)}
                  >
                    {c.fix.label} <ChevronRight size={12} />
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  )
}
