import { useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { Loader2, Save, RotateCcw, Search, ChevronDown, Undo2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  getSettings, updateSettings, type AccountingSettings,
  getAllAccountMappingKeys, updateAccountMapping, createAccountMapping,
  deleteAccountMapping,
  resetAccountMappings, type AccountMappingKeyRow,
  getChartOfAccounts, type Account,
  getTDSRateConfigs, updateTDSRateConfig, type TDSRateConfig,
  getLocationTaxProfiles, saveLocationTaxProfile,
  type LocationTaxProfile, type LocationTaxProfilesResponse,
} from '../lib/api'
import { useLocation } from '../contexts/LocationContext'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs'
import { Card } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Badge } from '../components/ui/badge'
import { Table, Thead, Tbody, Tr, Th, Td } from '../components/ui/table'
import { cn } from '../lib/utils'

const FIELD_CONFIG: { key: keyof AccountingSettings; label: string; placeholder: string; type?: string }[] = [
  { key: 'company_name', label: 'Company Name', placeholder: 'e.g. Seefmed Pvt Ltd' },
  { key: 'gstin', label: 'GSTIN', placeholder: 'e.g. 27AAABC1234D1ZQ' },
  { key: 'pan', label: 'PAN', placeholder: 'e.g. AAABC1234D' },
  { key: 'tan', label: 'TAN', placeholder: 'e.g. MUMT12345A' },
  { key: 'state_code', label: 'State Code', placeholder: 'e.g. 27' },
  // Backend stores the FY start as a month number (1-12); the old free-text
  // 'MM-DD' field invited values the API rejects.
  { key: 'financial_year_start', label: 'Financial Year Starts In', placeholder: '' },
  { key: 'registered_address', label: 'Registered Address', placeholder: 'Full registered address' },
]

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function CompanyInfoTab() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const { register, handleSubmit, reset, formState: { isDirty } } = useForm<AccountingSettings>()

  useEffect(() => {
    getSettings().then((data) => reset(data)).catch(() => toast.error('Failed to load settings')).finally(() => setLoading(false))
  }, [reset])

  async function onSubmit(data: AccountingSettings) {
    setSaving(true)
    try {
      const updated = await updateSettings(data)
      reset(updated)
      toast.success('Settings saved successfully')
    } catch { toast.error('Failed to save settings') } finally { setSaving(false) }
  }

  if (loading) return <div className="flex items-center justify-center h-40"><Loader2 size={24} className="animate-spin" style={{ color: 'var(--brand)' }} /></div>

  return (
    <Card className="p-6">
      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          {FIELD_CONFIG.map(({ key, label, placeholder, type }) => {
            const isAddress = key === 'registered_address'
            const isFyStart = key === 'financial_year_start'
            return (
              <div key={key} className={isAddress ? 'sm:col-span-2' : ''}>
                <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--ink-2)' }}>{label}</label>
                {isAddress ? (
                  <textarea {...register(key)} rows={3} placeholder={placeholder}
                    className="w-full px-3 py-2 text-sm border rounded-lg outline-none focus:shadow-[0_0_0_3px_rgba(15,157,154,0.18)] resize-none"
                    style={{ backgroundColor: 'var(--surface-0)', borderColor: 'var(--line)', color: 'var(--ink)' }}
                  />
                ) : isFyStart ? (
                  <select {...register(key, { valueAsNumber: true })}
                    className="w-full h-9 px-3 text-sm border rounded-lg outline-none focus:shadow-[0_0_0_3px_rgba(15,157,154,0.18)]"
                    style={{ backgroundColor: 'var(--surface-0)', borderColor: 'var(--line)', color: 'var(--ink)' }}
                  >
                    {MONTH_NAMES.map((name, i) => (
                      <option key={name} value={i + 1}>{name}</option>
                    ))}
                  </select>
                ) : (
                  <Input {...register(key)} type={type || 'text'} placeholder={placeholder} />
                )}
              </div>
            )
          })}
        </div>

        <div className="flex items-center justify-between pt-2 border-t" style={{ borderColor: 'var(--line)' }}>
          {isDirty ? (
            <p className="text-xs font-medium" style={{ color: 'var(--warning)' }}>You have unsaved changes</p>
          ) : (
            <p className="text-xs" style={{ color: 'var(--ink-3)' }}>All changes saved</p>
          )}
          <Button type="submit" disabled={saving || !isDirty} variant="primary">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            {saving ? 'Saving...' : 'Save Settings'}
          </Button>
        </div>
      </form>
    </Card>
  )
}

// ── Account-Mapping helpers ────────────────────────────────────────────────

// Group the 61 KEY_CHOICES into domains for the UI. Static mapping kept in
// sync with backend/core/models.py:AccountMapping.KEY_CHOICES. Any key not
// listed here ends up in "Other".
const KEY_GROUPS: { title: string; description: string; keys: string[] }[] = [
  {
    title: 'Settlement',
    description: 'Cash, bank, petty cash — the accounts vouchers settle into.',
    keys: ['CASH', 'BANK', 'PETTY_CASH'],
  },
  {
    title: 'Parties',
    description: 'Trade receivables, payables, customer/supplier/staff advances.',
    keys: ['TRADE_RECEIVABLES', 'TRADE_PAYABLES',
      'CUSTOMER_ADVANCE', 'SUPPLIER_ADVANCE', 'STAFF_ADVANCE'],
  },
  {
    title: 'Sales',
    description: 'POS and B2B sales accounts, returns, discounts allowed.',
    keys: ['SALES_POS', 'SALES_B2B', 'SALES_RETURNS', 'DISCOUNT_ALLOWED'],
  },
  {
    title: 'Purchases & Stock',
    description: 'Purchases (rare in perpetual mode), returns, COGS, stock.',
    keys: ['PURCHASES', 'PURCHASE_RETURNS', 'COGS', 'DISCOUNT_RECEIVED',
      'CLOSING_STOCK', 'INVENTORY_LOSS', 'EXPIRY_LOSS', 'STOCK_TRANSFER_TRANSIT'],
  },
  {
    title: 'GST',
    description: 'Output/Input GST and RCM — per store (each store files under its own GSTIN; see the GST Registrations tab).',
    keys: ['OUTPUT_CGST', 'OUTPUT_SGST', 'OUTPUT_IGST',
      'INPUT_CGST', 'INPUT_SGST', 'INPUT_IGST',
      'RCM_LIABILITY', 'GST_LATE_FEE'],
  },
  {
    title: 'TDS / TCS',
    description: 'Direct tax withholdings — shared across stores (single TAN).',
    keys: ['TDS_RECEIVABLE', 'TDS_PAYABLE', 'TCS_PAYABLE'],
  },
  {
    title: 'Banking',
    description: 'Bank charges and outstanding cheques.',
    keys: ['BANK_CHARGES', 'CHEQUES_OUTSTANDING'],
  },
  {
    title: 'Payroll',
    description: 'Salary expense and statutory withholdings.',
    keys: ['SALARY_EXPENSE', 'NET_SALARY_PAYABLE',
      'PF_PAYABLE', 'ESI_PAYABLE', 'PT_PAYABLE', 'STAFF_WELFARE'],
  },
  {
    title: 'Operating expenses',
    description: 'P&L lines for facility, professional, and admin costs.',
    keys: ['RENT_EXPENSE', 'ELECTRICITY_EXPENSE', 'INTEREST_EXPENSE', 'INTEREST_INCOME',
      'DOCTOR_FEES', 'PROFESSIONAL_FEES', 'AUDIT_FEES', 'LEGAL_FEES',
      'INSURANCE_EXPENSE', 'TRAVEL_CONVEYANCE', 'AMC_CHARGES',
      'REPAIRS_MAINTENANCE', 'OFFICE_MAINTENANCE',
      'PRINTING_STATIONERY', 'POSTAGE_COURIER', 'INTERNET_TELEPHONE',
      'DEPRECIATION_EXPENSE'],
  },
  {
    title: 'Period-end & control',
    description: 'Bad debts, round-off, suspense, equity — typically shared.',
    keys: ['BAD_DEBTS_EXPENSE', 'PROVISION_BAD_DEBTS', 'ROUND_OFF',
      'RETAINED_EARNINGS', 'OPENING_BALANCE_EQUITY', 'SUSPENSE'],
  },
]

// Narrow the account dropdown for keys whose mapping target has an obvious
// account_subtype. Anything missing here gets the unfiltered list.
const KEY_TO_SUBTYPE: Record<string, string> = {
  CASH: 'Cash', PETTY_CASH: 'Cash',
  BANK: 'Bank',
  TRADE_RECEIVABLES: 'Receivable',
  TRADE_PAYABLES: 'Payable',
  PF_PAYABLE: 'Payable', ESI_PAYABLE: 'Payable', PT_PAYABLE: 'Payable',
  NET_SALARY_PAYABLE: 'Payable', CHEQUES_OUTSTANDING: 'Payable',
  OUTPUT_CGST: 'Output_GST', OUTPUT_SGST: 'Output_GST', OUTPUT_IGST: 'Output_GST',
  RCM_LIABILITY: 'Output_GST',
  INPUT_CGST: 'Input_GST', INPUT_SGST: 'Input_GST', INPUT_IGST: 'Input_GST',
  TDS_RECEIVABLE: 'TDS_Receivable',
  TDS_PAYABLE: 'TDS_Payable', TCS_PAYABLE: 'TDS_Payable',
  RETAINED_EARNINGS: 'Retained_Earnings',
  OPENING_BALANCE_EQUITY: 'Capital',
  SALES_POS: 'Sales', SALES_B2B: 'Sales', SALES_RETURNS: 'Sales',
  PURCHASES: 'Purchases', PURCHASE_RETURNS: 'Purchases',
}

function AccountMappingsTab() {
  const { activeLocationId, activeLocation } = useLocation()
  const [rows, setRows] = useState<AccountMappingKeyRow[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'mapped' | 'unmapped' | 'overridden'>('all')
  // 'auto' = if a location is active, edit its overrides; otherwise edit shared.
  // 'shared' = always edit the shared (NULL-location) row, regardless of active loc.
  const [scope, setScope] = useState<'auto' | 'shared'>('auto')
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())

  const editingLocationId = scope === 'shared' ? null : activeLocationId

  async function load() {
    setLoading(true)
    try {
      const [r, a] = await Promise.all([
        getAllAccountMappingKeys(
          editingLocationId == null ? { location_id: 'null' } : { location_id: editingLocationId },
        ),
        // location_scope=auto restricts the dropdown to current-store + shared.
        getChartOfAccounts({ is_active: 'true', location_scope: 'auto' }),
      ])
      setRows(r)
      setAccounts(a)
    } catch {
      toast.error('Failed to load mappings')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [editingLocationId])

  async function applyAccount(row: AccountMappingKeyRow, accountId: number) {
    try {
      // When editing per-location:
      //   - if an override already exists, PATCH it
      //   - else POST a new row scoped to this location
      // When editing shared (NULL):
      //   - if the *default* row exists, PATCH it (mapping_id with no override)
      //   - else POST a new shared row.
      if (editingLocationId == null) {
        if (row.mapping_id && !row.has_override) {
          await updateAccountMapping(row.mapping_id, { account: accountId, location_id: null })
        } else {
          await createAccountMapping({ key: row.key, account: accountId, location_id: null })
        }
      } else {
        if (row.override_id) {
          await updateAccountMapping(row.override_id, { account: accountId, location_id: editingLocationId })
        } else {
          await createAccountMapping({ key: row.key, account: accountId, location_id: editingLocationId })
        }
      }
      await load()
    } catch {
      toast.error('Failed to update mapping')
    }
  }

  async function clearOverride(row: AccountMappingKeyRow) {
    if (!row.override_id) return
    try {
      await deleteAccountMapping(row.override_id)
      toast.success('Override cleared — using shared default')
      await load()
    } catch {
      toast.error('Failed to clear override')
    }
  }

  async function resetGroup(groupKeys: string[]) {
    try {
      const result = await resetAccountMappings(groupKeys)
      toast.success(`Reset ${(result.created ?? 0) + (result.updated ?? 0)} mapping(s) to default`)
      await load()
    } catch {
      toast.error('Failed to reset group')
    }
  }

  function toggleGroup(title: string) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(title)) next.delete(title)
      else next.add(title)
      return next
    })
  }

  const rowByKey = useMemo(() => {
    const m = new Map<string, AccountMappingKeyRow>()
    for (const r of rows) m.set(r.key, r)
    return m
  }, [rows])

  const filteredVisible = useMemo(() => {
    const lower = search.toLowerCase()
    return (row: AccountMappingKeyRow) => {
      if (lower) {
        if (
          !row.key.toLowerCase().includes(lower) &&
          !row.label.toLowerCase().includes(lower) &&
          !(row.account_code ?? '').toLowerCase().includes(lower) &&
          !(row.account_name ?? '').toLowerCase().includes(lower)
        ) return false
      }
      if (filter === 'mapped' && !row.mapping_id) return false
      if (filter === 'unmapped' && row.mapping_id) return false
      if (filter === 'overridden' && !row.has_override) return false
      return true
    }
  }, [search, filter])

  const counts = useMemo(() => ({
    mapped: rows.filter((r) => r.mapping_id !== null).length,
    unmapped: rows.filter((r) => r.mapping_id === null).length,
    overridden: rows.filter((r) => r.has_override).length,
  }), [rows])

  if (loading) return (
    <div className="flex items-center justify-center h-40">
      <Loader2 size={24} className="animate-spin" style={{ color: 'var(--brand)' }} />
    </div>
  )

  const scopeLabel = editingLocationId == null
    ? 'Shared (all stores)'
    : `${activeLocation?.name ?? 'Store ' + editingLocationId} override`

  return (
    <div className="space-y-4">
      {/* Header strip */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="text-sm" style={{ color: 'var(--ink-2)' }}>
            Map each semantic key to a Chart-of-Accounts row. The accounting
            engine looks up these mappings whenever it auto-posts a JE.
          </p>
          <p className="text-xs mt-1" style={{ color: 'var(--ink-3)' }}>
            Editing:{' '}
            <span style={{ color: 'var(--ink)', fontWeight: 500 }}>{scopeLabel}</span>
            {' · '}
            <span style={{ color: 'var(--ink)' }}>{counts.mapped}</span> mapped ·{' '}
            <span style={{ color: counts.unmapped ? 'var(--warning)' : 'var(--ink-3)' }}>
              {counts.unmapped}
            </span> unmapped
            {activeLocationId != null && (
              <> · <span style={{ color: 'var(--brand)' }}>{counts.overridden}</span> per-store overrides</>
            )}
          </p>
        </div>
        <Button onClick={() => resetGroup(Object.values(KEY_GROUPS).flatMap((g) => g.keys))} variant="secondary" size="sm">
          <RotateCcw size={12} /> Reset all to defaults
        </Button>
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-md">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2"
                 style={{ color: 'var(--ink-3)' }} />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search keys, labels, account codes…"
            className="pl-9 py-1.5"
          />
        </div>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as typeof filter)}
          className="px-3 py-1.5 text-sm border rounded-lg"
          style={{ background: 'var(--surface-0)', borderColor: 'var(--line)', color: 'var(--ink)' }}
        >
          <option value="all">All ({rows.length})</option>
          <option value="mapped">Mapped ({counts.mapped})</option>
          <option value="unmapped">Unmapped ({counts.unmapped})</option>
          {activeLocationId != null && (
            <option value="overridden">With override ({counts.overridden})</option>
          )}
        </select>
        {activeLocationId != null && (
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value as typeof scope)}
            className="px-3 py-1.5 text-sm border rounded-lg"
            style={{ background: 'var(--surface-0)', borderColor: 'var(--line)', color: 'var(--ink)' }}
            title="Edit per-store overrides, or the shared defaults that apply when no override exists"
          >
            <option value="auto">Edit: per-store override</option>
            <option value="shared">Edit: shared defaults</option>
          </select>
        )}
      </div>

      {/* Grouped cards */}
      <div className="space-y-3">
        {KEY_GROUPS.map((group) => {
          const groupRows = group.keys
            .map((k) => rowByKey.get(k))
            .filter((r): r is AccountMappingKeyRow => !!r)
            .filter(filteredVisible)
          if (groupRows.length === 0) return null
          const unmappedInGroup = groupRows.filter((r) => !r.mapping_id).length
          const collapsed = collapsedGroups.has(group.title)
          return (
            <Card key={group.title} className="overflow-hidden">
              <button
                onClick={() => toggleGroup(group.title)}
                className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-[var(--color-hover-bg)] transition-colors"
                style={{ background: 'var(--surface-1)' }}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <ChevronDown
                    size={14}
                    className="transition-transform"
                    style={{
                      color: 'var(--ink-3)',
                      transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
                    }}
                  />
                  <div className="min-w-0">
                    <h3 className="text-sm font-medium truncate" style={{ color: 'var(--ink)' }}>
                      {group.title}
                    </h3>
                    <p className="text-xs truncate" style={{ color: 'var(--ink-3)' }}>
                      {group.description}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <Badge variant="default">{groupRows.length}</Badge>
                  {unmappedInGroup > 0 && (
                    <Badge variant="warning">{unmappedInGroup} unmapped</Badge>
                  )}
                  <Button
                    onClick={(e) => { e.stopPropagation(); resetGroup(group.keys) }}
                    variant="ghost" size="sm" title="Reset this group's shared defaults"
                  >
                    <RotateCcw size={12} />
                  </Button>
                </div>
              </button>
              {!collapsed && (
                <Table>
                  <Thead>
                    <Tr style={{ background: 'var(--surface-0)' }}>
                      <Th className="w-[180px]">Key</Th>
                      <Th>Description</Th>
                      <Th className="w-[320px]">Account</Th>
                      <Th className="w-[160px]">Status</Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {groupRows.map((row) => {
                      const isMapped = row.mapping_id !== null
                      const isSharedKey = row.is_shared_key
                      const editingThisIsBlocked = isSharedKey && editingLocationId != null
                      const subtype = KEY_TO_SUBTYPE[row.key]
                      const dropdownAccounts = subtype
                        ? accounts.filter((a) => a.account_subtype === subtype)
                        : accounts
                      return (
                        <Tr key={row.key}>
                          <Td className="font-mono text-xs align-top pt-3"
                              style={{ color: 'var(--ink-2)' }}>
                            <div className="flex flex-col gap-1">
                              <span>{row.key}</span>
                              {isSharedKey && (
                                <Badge variant="default" className="self-start text-[10px]">Shared only</Badge>
                              )}
                              {row.has_override && editingLocationId != null && (
                                <Badge variant="success" className="self-start text-[10px]">Override</Badge>
                              )}
                            </div>
                          </Td>
                          <Td className="text-sm align-top pt-3" style={{ color: 'var(--ink-2)' }}>
                            {row.label}
                            {row.default_code && (
                              <span className="ml-2 text-xs" style={{ color: 'var(--ink-3)' }}>
                                default: {row.default_code}
                              </span>
                            )}
                          </Td>
                          <Td>
                            <select
                              value={row.account ?? ''}
                              disabled={editingThisIsBlocked}
                              onChange={(e) => {
                                const v = e.target.value
                                if (v) applyAccount(row, Number(v))
                              }}
                              className={cn(
                                'w-full h-9 px-3 text-sm border rounded-md outline-none focus:shadow-[0_0_0_3px_rgba(15,157,154,0.18)]',
                                editingThisIsBlocked && 'opacity-50 cursor-not-allowed',
                              )}
                              style={{
                                backgroundColor: 'var(--surface-0)',
                                borderColor: isMapped ? 'var(--line)' : 'var(--warning)',
                                color: 'var(--ink)',
                              }}
                            >
                              {!isMapped && (
                                <option value="">
                                  — Not mapped{row.default_code ? ` (suggested: ${row.default_code})` : ''} —
                                </option>
                              )}
                              {dropdownAccounts.map((acc) => (
                                <option key={acc.id} value={acc.id}>
                                  {acc.account_code} — {acc.account_name}
                                </option>
                              ))}
                            </select>
                            {editingThisIsBlocked && (
                              <p className="mt-1 text-[11px]" style={{ color: 'var(--ink-3)' }}>
                                Shared key — switch scope to "Edit: shared defaults" to change.
                              </p>
                            )}
                          </Td>
                          <Td className="align-top pt-3">
                            <div className="flex items-center gap-2">
                              {isMapped ? (
                                <Badge variant="success">Mapped</Badge>
                              ) : (
                                <Badge variant="warning">Not mapped</Badge>
                              )}
                              {row.has_override && editingLocationId != null && (
                                <button
                                  onClick={() => clearOverride(row)}
                                  className="p-1.5 rounded transition-colors hover:bg-[var(--color-hover-bg)]"
                                  style={{ color: 'var(--ink-3)' }}
                                  title="Clear this per-store override — fall back to shared default"
                                  aria-label="Clear per-store override"
                                >
                                  <Undo2 size={13} />
                                </button>
                              )}
                            </div>
                          </Td>
                        </Tr>
                      )
                    })}
                  </Tbody>
                </Table>
              )}
            </Card>
          )
        })}
      </div>
    </div>
  )
}

function TDSRatesTab() {
  const [configs, setConfigs] = useState<TDSRateConfig[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getTDSRateConfigs().then(setConfigs).catch(() => toast.error('Failed to load TDS rates')).finally(() => setLoading(false))
  }, [])

  async function handleUpdate(id: number, field: string, value: string) {
    try {
      const updated = await updateTDSRateConfig(id, { [field]: value })
      setConfigs(configs.map(c => c.id === id ? updated : c))
    } catch { toast.error('Failed to update rate') }
  }

  if (loading) return <div className="flex items-center justify-center h-40"><Loader2 size={24} className="animate-spin" style={{ color: 'var(--brand)' }} /></div>

  return (
    <Card className="overflow-hidden">
      <Table>
        <Thead>
          <Tr className="bg-slate-50">
            <Th>Section</Th>
            <Th>Type</Th>
            <Th className="text-right">Rate %</Th>
            <Th className="text-right">Threshold</Th>
            <Th>FY</Th>
            <Th className="text-center">Active</Th>
          </Tr>
        </Thead>
        <Tbody>
          {configs.length === 0 ? (
            <Tr><Td colSpan={6} className="text-center py-12 text-slate-400 text-sm">No TDS rate configurations. Using fallback rates.</Td></Tr>
          ) : configs.map((c) => (
            <Tr key={c.id}>
              <Td className="font-mono text-xs text-slate-500">{c.section}</Td>
              <Td className="text-slate-500">{c.deductee_type}</Td>
              <Td className="text-right">
                <input type="number" step="0.01" value={c.rate} onChange={(e) => handleUpdate(c.id, 'rate', e.target.value)}
                  className="w-20 text-right text-xs border border-slate-200 rounded px-2 py-1 font-mono bg-white text-slate-900 focus:outline-none focus:ring-1 focus:ring-teal-500" />
              </Td>
              <Td className="text-right">
                <input type="number" value={c.threshold} onChange={(e) => handleUpdate(c.id, 'threshold', e.target.value)}
                  className="w-28 text-right text-xs border border-slate-200 rounded px-2 py-1 font-mono bg-white text-slate-900 focus:outline-none focus:ring-1 focus:ring-teal-500" />
              </Td>
              <Td className="text-xs text-slate-500">{c.fy_start} to {c.fy_end}</Td>
              <Td className="text-center">
                <Badge variant={c.is_active ? 'success' : 'default'}>
                  {c.is_active ? 'Active' : 'Inactive'}
                </Badge>
              </Td>
            </Tr>
          ))}
        </Tbody>
      </Table>
    </Card>
  )
}

type ProfileDraft = { gstin: string; state_code: string; legal_name: string }

function GstRegistrationsTab() {
  const [data, setData] = useState<LocationTaxProfilesResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [drafts, setDrafts] = useState<Record<number, ProfileDraft>>({})
  const [savingId, setSavingId] = useState<number | null>(null)

  async function load() {
    setLoading(true)
    try {
      const res = await getLocationTaxProfiles()
      setData(res)
      const d: Record<number, ProfileDraft> = {}
      for (const p of res.profiles) {
        d[p.location_id] = { gstin: p.gstin, state_code: p.state_code, legal_name: p.legal_name }
      }
      setDrafts(d)
    } catch {
      toast.error('Failed to load GST registrations')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  function setField(locId: number, field: keyof ProfileDraft, value: string) {
    setDrafts((prev) => ({ ...prev, [locId]: { ...prev[locId], [field]: value } }))
  }

  function isDirty(p: LocationTaxProfile) {
    const d = drafts[p.location_id]
    return !!d && (d.gstin !== p.gstin || d.state_code !== p.state_code || d.legal_name !== p.legal_name)
  }

  async function save(p: LocationTaxProfile) {
    const d = drafts[p.location_id]
    if (!d) return
    if (d.gstin && d.gstin.trim().length !== 15) {
      toast.error('GSTIN must be exactly 15 characters')
      return
    }
    setSavingId(p.location_id)
    try {
      await saveLocationTaxProfile({
        location_id: p.location_id,
        gstin: d.gstin.trim(),
        state_code: d.state_code.trim(),
        legal_name: d.legal_name.trim(),
      })
      toast.success(`Saved GST registration for ${p.location_name}`)
      await load()
    } catch {
      toast.error('Failed to save GST registration')
    } finally {
      setSavingId(null)
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center h-40">
      <Loader2 size={24} className="animate-spin" style={{ color: 'var(--brand)' }} />
    </div>
  )

  const profiles = data?.profiles ?? []

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <p className="text-sm" style={{ color: 'var(--ink-2)' }}>
          Each store files under its own GSTIN. The GSTIN is taken{' '}
          <span className="font-medium">live from the pharmacy store settings</span>{' '}
          — GST returns (GSTR-1/3B), e-invoice IRNs and the grand summary all use
          it automatically, so there's nothing to re-type here.
        </p>
        <p className="text-xs mt-1.5" style={{ color: 'var(--ink-3)' }}>
          Set an override below only if a store should file under a different
          GSTIN than pharmacy has. A store with no GSTIN in pharmacy (and no
          override) is shown as <span className="font-medium" style={{ color: 'var(--danger)' }}>unconfigured</span> — set its
          GSTIN in the pharmacy store settings.
        </p>
      </Card>

      <Card className="overflow-hidden">
        <Table>
          <Thead>
            <Tr style={{ background: 'var(--surface-1)' }}>
              <Th>Store</Th>
              <Th className="w-[220px]">GSTIN override</Th>
              <Th className="w-[90px]">State</Th>
              <Th className="w-[240px]">Legal / trade name (optional)</Th>
              <Th className="w-[120px]" />
            </Tr>
          </Thead>
          <Tbody>
            {profiles.length === 0 ? (
              <Tr><Td colSpan={5} className="text-center py-12 text-sm" style={{ color: 'var(--ink-3)' }}>No locations available.</Td></Tr>
            ) : profiles.map((p) => {
              const d = drafts[p.location_id] ?? { gstin: '', state_code: '', legal_name: '' }
              return (
                <Tr key={p.location_id}>
                  <Td className="align-top pt-3">
                    <div className="text-sm" style={{ color: 'var(--ink)' }}>{p.location_name}</div>
                    {p.source === 'pharma' && (
                      <div className="text-[11px] mt-0.5 flex items-center gap-1.5" style={{ color: 'var(--ink-3)' }}>
                        <span className="px-1 py-0.5 rounded text-[10px] font-medium" style={{ background: 'var(--surface-1)', color: 'var(--ink-2)' }}>from pharmacy</span>
                        <span className="font-mono">{p.pharma_gstin}</span>
                      </div>
                    )}
                    {p.source === 'override' && (
                      <div className="text-[11px] mt-0.5" style={{ color: 'var(--ink-3)' }}>
                        accounting override
                        {p.pharma_gstin ? <> · pharmacy has <span className="font-mono">{p.pharma_gstin}</span></> : null}
                      </div>
                    )}
                    {p.source === 'unconfigured' && (
                      <div className="text-[11px] mt-0.5 font-medium" style={{ color: 'var(--danger)' }}>
                        No GSTIN — set it in the pharmacy store settings
                      </div>
                    )}
                  </Td>
                  <Td className="align-top">
                    <Input
                      value={d.gstin}
                      onChange={(e) => setField(p.location_id, 'gstin', e.target.value.toUpperCase())}
                      placeholder={p.pharma_gstin ? 'override pharmacy GSTIN' : '15-char GSTIN'}
                      maxLength={15}
                      className="font-mono"
                    />
                  </Td>
                  <Td className="align-top">
                    <Input
                      value={d.state_code}
                      onChange={(e) => setField(p.location_id, 'state_code', e.target.value)}
                      placeholder={d.gstin ? d.gstin.slice(0, 2) : '—'}
                      maxLength={2}
                      className="font-mono"
                    />
                  </Td>
                  <Td className="align-top">
                    <Input
                      value={d.legal_name}
                      onChange={(e) => setField(p.location_id, 'legal_name', e.target.value)}
                      placeholder="defaults to company name"
                    />
                  </Td>
                  <Td className="align-top pt-2">
                    <Button
                      onClick={() => save(p)}
                      disabled={savingId === p.location_id || !isDirty(p)}
                      variant="primary"
                      size="sm"
                    >
                      {savingId === p.location_id ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                      Save
                    </Button>
                  </Td>
                </Tr>
              )
            })}
          </Tbody>
        </Table>
      </Card>
    </div>
  )
}

export default function SettingsPage() {
  return (
    <div className="max-w-7xl mx-auto space-y-5">
      <div className="mb-6">
        <h1 className="text-xl font-semibold" style={{ color: "var(--ink)", letterSpacing: "-0.01em" }}>Settings</h1>
        <p className="text-sm mt-0.5" style={{ color: "var(--ink-2)" }}>Company, account mappings, and tax configuration</p>
      </div>

      <Tabs defaultValue="company">
        <TabsList>
          {[
            { value: 'company', label: 'Company Info' },
            { value: 'gst-registrations', label: 'GST Registrations' },
            { value: 'mappings', label: 'Account Mappings' },
            { value: 'tds-rates', label: 'TDS Rates' },
          ].map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="company"><CompanyInfoTab /></TabsContent>
        <TabsContent value="gst-registrations"><GstRegistrationsTab /></TabsContent>
        <TabsContent value="mappings"><AccountMappingsTab /></TabsContent>
        <TabsContent value="tds-rates"><TDSRatesTab /></TabsContent>
      </Tabs>
    </div>
  )
}
