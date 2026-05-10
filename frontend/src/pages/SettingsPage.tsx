import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { Loader2, Save, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import {
  getSettings, updateSettings, type AccountingSettings,
  getAllAccountMappingKeys, updateAccountMapping, createAccountMapping,
  resetAccountMappings, type AccountMappingKeyRow,
  getChartOfAccounts, type Account,
  getTDSRateConfigs, updateTDSRateConfig, type TDSRateConfig,
} from '../lib/api'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs'
import { Card } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Badge } from '../components/ui/badge'
import { Table, Thead, Tbody, Tr, Th, Td } from '../components/ui/table'

const FIELD_CONFIG: { key: keyof AccountingSettings; label: string; placeholder: string; type?: string }[] = [
  { key: 'company_name', label: 'Company Name', placeholder: 'e.g. Seefmed Pvt Ltd' },
  { key: 'gstin', label: 'GSTIN', placeholder: 'e.g. 27AAABC1234D1ZQ' },
  { key: 'pan', label: 'PAN', placeholder: 'e.g. AAABC1234D' },
  { key: 'tan', label: 'TAN', placeholder: 'e.g. MUMT12345A' },
  { key: 'state_code', label: 'State Code', placeholder: 'e.g. 27' },
  { key: 'financial_year_start', label: 'Financial Year Start', placeholder: 'MM-DD', type: 'text' },
  { key: 'registered_address', label: 'Registered Address', placeholder: 'Full registered address' },
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
            return (
              <div key={key} className={isAddress ? 'sm:col-span-2' : ''}>
                <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--ink-2)' }}>{label}</label>
                {isAddress ? (
                  <textarea {...register(key)} rows={3} placeholder={placeholder}
                    className="w-full px-3 py-2 text-sm border rounded-lg outline-none focus:shadow-[0_0_0_3px_rgba(15,157,154,0.18)] resize-none"
                    style={{ backgroundColor: 'var(--surface-0)', borderColor: 'var(--line)', color: 'var(--ink)' }}
                  />
                ) : (
                  <Input {...register(key)} type={type || 'text'} placeholder={placeholder} />
                )}
              </div>
            )
          })}
        </div>

        {/* Stock method — controls how inventory hits the GL */}
        <div className="border-t pt-5" style={{ borderColor: 'var(--line)' }}>
          <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--ink-2)' }}>
            Stock Accounting Method
          </label>
          <select
            {...register('stock_method')}
            className="w-full sm:w-1/2 h-9 px-3 text-sm border rounded-md outline-none focus:shadow-[0_0_0_3px_rgba(15,157,154,0.18)]"
            style={{ backgroundColor: 'var(--surface-0)', borderColor: 'var(--line)', color: 'var(--ink)' }}
          >
            <option value="periodic">Periodic — purchases → 5100 Purchases; closing stock at period-end (Tally default)</option>
            <option value="perpetual">Perpetual — purchases → 1190 Closing Stock; COGS posted per sale</option>
          </select>
          <p className="text-[11px] mt-1.5" style={{ color: 'var(--ink-3)' }}>
            Switching mid-stream affects only future entries. Posted JVs are not retroactively recoded.
          </p>
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

function AccountMappingsTab() {
  const [rows, setRows] = useState<AccountMappingKeyRow[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    try {
      const [r, a] = await Promise.all([getAllAccountMappingKeys(), getChartOfAccounts()])
      setRows(r)
      setAccounts(a)
    } catch {
      toast.error('Failed to load mappings')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  async function applyAccount(row: AccountMappingKeyRow, accountId: number) {
    try {
      if (row.mapping_id) {
        await updateAccountMapping(row.mapping_id, { account: accountId })
      } else {
        await createAccountMapping({ key: row.key, account: accountId })
      }
      // Refresh in place to reflect created mapping_id and labels.
      await load()
    } catch {
      toast.error('Failed to update mapping')
    }
  }

  async function handleReset() {
    try {
      await resetAccountMappings()
      await load()
      toast.success('Mappings reset to defaults')
    } catch { toast.error('Failed to reset mappings') }
  }

  if (loading) return (
    <div className="flex items-center justify-center h-40">
      <Loader2 size={24} className="animate-spin" style={{ color: 'var(--brand)' }} />
    </div>
  )

  const mapped = rows.filter((r) => r.mapping_id !== null)
  const unmapped = rows.filter((r) => r.mapping_id === null)

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm" style={{ color: 'var(--ink-2)' }}>
          Map semantic account keys to your Chart of Accounts.{' '}
          <span style={{ color: 'var(--ink)' }}>{mapped.length}</span> mapped ·{' '}
          <span style={{ color: unmapped.length ? 'var(--warning)' : 'var(--ink-3)' }}>
            {unmapped.length}
          </span>{' '}
          unmapped
        </p>
        <Button onClick={handleReset} variant="secondary" size="sm">
          <RotateCcw size={12} /> Reset Defaults
        </Button>
      </div>
      <Card className="overflow-hidden">
        <Table>
          <Thead>
            <Tr style={{ background: 'var(--surface-1)' }}>
              <Th>Key</Th>
              <Th>Description</Th>
              <Th>Account</Th>
              <Th>Status</Th>
            </Tr>
          </Thead>
          <Tbody>
            {rows.map((row) => {
              const isMapped = row.mapping_id !== null
              return (
                <Tr key={row.key}>
                  <Td className="font-mono text-xs" style={{ color: 'var(--ink-2)' }}>{row.key}</Td>
                  <Td className="text-sm" style={{ color: 'var(--ink-2)' }}>{row.label}</Td>
                  <Td>
                    <select
                      value={row.account ?? ''}
                      onChange={(e) => {
                        const v = e.target.value
                        if (v) applyAccount(row, Number(v))
                      }}
                      className="w-full h-9 px-3 text-sm border rounded-md outline-none focus:shadow-[0_0_0_3px_rgba(15,157,154,0.18)]"
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
                      {accounts.map((acc) => (
                        <option key={acc.id} value={acc.id}>
                          {acc.account_code} — {acc.account_name}
                        </option>
                      ))}
                    </select>
                  </Td>
                  <Td>
                    {isMapped ? (
                      <Badge variant="success">Mapped</Badge>
                    ) : (
                      <Badge variant="warning">Not mapped</Badge>
                    )}
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

export default function SettingsPage() {
  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div className="mb-6">
        <h1 className="text-xl font-semibold" style={{ color: "var(--ink)", letterSpacing: "-0.01em" }}>Settings</h1>
        <p className="text-sm mt-0.5" style={{ color: "var(--ink-2)" }}>Company, account mappings, and tax configuration</p>
      </div>

      <Tabs defaultValue="company">
        <TabsList>
          {[
            { value: 'company', label: 'Company Info' },
            { value: 'mappings', label: 'Account Mappings' },
            { value: 'tds-rates', label: 'TDS Rates' },
          ].map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="company"><CompanyInfoTab /></TabsContent>
        <TabsContent value="mappings"><AccountMappingsTab /></TabsContent>
        <TabsContent value="tds-rates"><TDSRatesTab /></TabsContent>
      </Tabs>
    </div>
  )
}
