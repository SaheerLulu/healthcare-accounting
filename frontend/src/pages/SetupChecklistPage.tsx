import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CheckCircle2, AlertTriangle, ChevronRight, Loader2, Settings as SettingsIcon } from 'lucide-react'
import {
  getSettings, getAccountMappings, getBankAccounts,
  type AccountingSettings, type AccountMapping, type BankAccount,
} from '../lib/api'
import { Card } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { useHintRegister } from '../contexts/HotkeyContext'

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

  useHintRegister([
    { chord: 'F11', label: 'Setup' },
    { chord: 'Esc', label: 'Back' },
  ])

  useEffect(() => {
    let cancelled = false
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
        detail: settings.financial_year_start,
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
      {
        id: 'stock-method',
        label: 'Stock accounting method',
        description: settings.stock_method === 'perpetual'
          ? 'Perpetual — purchases hit 1190 Closing Stock and COGS posts per sale'
          : 'Periodic — purchases hit 5100; closing stock posted at period end (Tally default)',
        ok: true,
        detail: settings.stock_method === 'perpetual' ? 'Perpetual' : 'Periodic',
        fix: { label: 'Change in Settings', to: '/settings' },
        required: false,
      },
    ]
  }, [settings, mappings, banks])

  const required = checks.filter((c) => c.required)
  const optional = checks.filter((c) => !c.required)
  const requiredOk = required.filter((c) => c.ok).length
  const requiredTotal = required.length
  const allRequiredDone = requiredOk === requiredTotal && requiredTotal > 0

  if (loading || !settings) {
    return <div className="p-12 text-center"><Loader2 className="animate-spin inline" size={24} style={{ color: 'var(--brand)' }} /></div>
  }

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-baseline gap-3">
          <span
            className="mono text-xs font-bold px-2 py-0.5 rounded"
            style={{
              background: 'rgba(15,157,154,0.12)',
              color: 'var(--brand)',
              border: '1px solid rgba(15,157,154,0.25)',
            }}
          >
            F11
          </span>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--ink)', letterSpacing: '-0.01em' }}>
            Setup Checklist
          </h1>
        </div>
        <Button variant="secondary" onClick={() => navigate('/settings')}>
          <SettingsIcon size={14} /> Settings
        </Button>
      </div>

      <Card className="p-5">
        <div className="flex items-center gap-3">
          {allRequiredDone ? (
            <>
              <div
                className="w-10 h-10 rounded-lg flex items-center justify-center"
                style={{ background: 'rgba(31,138,76,0.12)' }}
              >
                <CheckCircle2 size={20} style={{ color: 'var(--success)' }} />
              </div>
              <div>
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
                className="w-10 h-10 rounded-lg flex items-center justify-center"
                style={{ background: 'rgba(199,122,17,0.12)' }}
              >
                <AlertTriangle size={20} style={{ color: 'var(--warning)' }} />
              </div>
              <div>
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
          <div className="text-2xl font-semibold mono" style={{ color: 'var(--brand)' }}>
            {Math.round((requiredOk / Math.max(requiredTotal, 1)) * 100)}%
          </div>
        </div>
      </Card>

      <SectionList title="Required" items={required} navigate={navigate} />
      <SectionList title="Optional" items={optional} navigate={navigate} />
    </div>
  )
}

function SectionList({ title, items, navigate }: {
  title: string
  items: CheckItem[]
  navigate: (to: string) => void
}) {
  if (items.length === 0) return null
  return (
    <div>
      <div
        className="mono uppercase text-[11px] font-semibold tracking-wider mb-2"
        style={{ color: 'var(--ink-3)' }}
      >
        {title}
      </div>
      <Card className="p-0 overflow-hidden">
        <ul>
          {items.map((c, i) => (
            <li
              key={c.id}
              className={i < items.length - 1 ? 'border-b' : ''}
              style={i < items.length - 1 ? { borderColor: 'var(--line)' } : undefined}
            >
              <div className="flex items-center gap-3 px-4 py-3">
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
