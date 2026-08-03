import { useEffect, useState } from 'react'
import { Plus, Pencil, Trash2, Loader2, FileSliders, X } from 'lucide-react'
import { toast } from 'sonner'
import * as Dialog from '@radix-ui/react-dialog'
import {
  listVoucherTypeProfiles, createVoucherTypeProfile, updateVoucherTypeProfile, deleteVoucherTypeProfile,
  type VoucherTypeProfile,
} from '../lib/api'
import { voucherList } from './vouchers/voucherConfig'
import { Card } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Badge } from '../components/ui/badge'

export default function VoucherTypesPage() {
  const [profiles, setProfiles] = useState<VoucherTypeProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<VoucherTypeProfile | null>(null)
  const [showForm, setShowForm] = useState(false)

  async function load() {
    setLoading(true)
    try {
      setProfiles(await listVoucherTypeProfiles())
    } catch {
      toast.error('Failed to load voucher types')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  async function remove(p: VoucherTypeProfile) {
    if (!confirm(`Delete voucher type "${p.name}"?`)) return
    try { await deleteVoucherTypeProfile(p.id); toast.success('Deleted'); load() }
    catch { toast.error('Failed') }
  }

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-baseline gap-2 flex-wrap">
          <FileSliders size={18} style={{ color: 'var(--brand)' }} />
          <h1 className="text-xl font-semibold" style={{ color: 'var(--ink)', letterSpacing: '-0.01em' }}>
            Voucher Types
          </h1>
          <span className="text-sm" style={{ color: 'var(--ink-2)' }}>
            · Custom voucher classes layered on the 8 system types
          </span>
        </div>
        <Button onClick={() => { setEditing(null); setShowForm(true) }}>
          <Plus size={14} /> New Voucher Type
        </Button>
      </div>

      <Card className="p-0 overflow-hidden">
        {loading ? (
          <div className="text-center py-12">
            <Loader2 size={20} className="animate-spin inline" style={{ color: 'var(--brand)' }} />
          </div>
        ) : profiles.length === 0 ? (
          <div className="text-center py-12 text-sm" style={{ color: 'var(--ink-3)' }}>
            No custom voucher types yet — the 8 default Tally voucher types remain available
          </div>
        ) : (
          <div className="table-scroll">
            <table className="w-full text-sm min-w-[680px]">
              <thead className="border-b" style={{ background: 'var(--surface-1)', borderColor: 'var(--line)' }}>
                <tr>
                  <th className="text-left text-[10px] font-semibold uppercase mono px-4 py-2 tracking-wider" style={{ color: 'var(--ink-2)' }}>Name</th>
                  <th className="text-left text-[10px] font-semibold uppercase mono px-4 py-2 tracking-wider" style={{ color: 'var(--ink-2)' }}>Base Type</th>
                  <th className="text-left text-[10px] font-semibold uppercase mono px-4 py-2 tracking-wider" style={{ color: 'var(--ink-2)' }}>Prefix</th>
                  <th className="text-left text-[10px] font-semibold uppercase mono px-4 py-2 tracking-wider" style={{ color: 'var(--ink-2)' }}>Numbering</th>
                  <th className="text-center text-[10px] font-semibold uppercase mono px-4 py-2 tracking-wider" style={{ color: 'var(--ink-2)' }}>Active</th>
                  <th className="w-24" />
                </tr>
              </thead>
              <tbody>
                {profiles.map((p) => (
                  <tr key={p.id} className="border-b last:border-0" style={{ borderColor: 'var(--line)' }}>
                    <td className="px-4 py-2.5 font-medium" style={{ color: 'var(--ink)' }}>{p.name}</td>
                    <td className="px-4 py-2.5" style={{ color: 'var(--ink-2)' }}>
                      {p.base_type_display || p.base_type}
                    </td>
                    <td className="px-4 py-2.5 mono text-xs" style={{ color: 'var(--ink-3)' }}>{p.prefix || '—'}</td>
                    <td className="px-4 py-2.5 text-xs" style={{ color: 'var(--ink-2)' }}>
                      {p.numbering_method === 'AUTO' ? 'Auto' : 'Manual'}
                      {p.restart_yearly ? ' · yearly' : ''}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <Badge variant={p.is_active ? 'success' : 'default'}>
                        {p.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </td>
                    <td className="px-2 py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          className="p-1.5 rounded transition-colors"
                          style={{ color: 'var(--ink-3)' }}
                          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--brand)'; e.currentTarget.style.backgroundColor = 'var(--color-hover-bg)' }}
                          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--ink-3)'; e.currentTarget.style.backgroundColor = 'transparent' }}
                          onClick={() => { setEditing(p); setShowForm(true) }}
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          className="p-1.5 rounded transition-colors"
                          style={{ color: 'var(--ink-3)' }}
                          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--danger)'; e.currentTarget.style.backgroundColor = 'var(--color-hover-bg)' }}
                          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--ink-3)'; e.currentTarget.style.backgroundColor = 'transparent' }}
                          onClick={() => remove(p)}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <ProfileForm open={showForm} onOpenChange={setShowForm} editing={editing} onSaved={load} />
    </div>
  )
}

function ProfileForm({ open, onOpenChange, editing, onSaved }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  editing: VoucherTypeProfile | null
  onSaved: () => void
}) {
  const [name, setName] = useState('')
  const [baseType, setBaseType] = useState('SALE')
  const [prefix, setPrefix] = useState('')
  const [numbering, setNumbering] = useState<'AUTO' | 'MANUAL'>('AUTO')
  const [restartYearly, setRestartYearly] = useState(true)
  const [defaultNarration, setDefaultNarration] = useState('')
  const [active, setActive] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      setName(editing?.name || '')
      setBaseType(editing?.base_type || 'SALE')
      setPrefix(editing?.prefix || '')
      setNumbering(editing?.numbering_method || 'AUTO')
      setRestartYearly(editing?.restart_yearly ?? true)
      setDefaultNarration(editing?.default_narration || '')
      setActive(editing?.is_active ?? true)
    }
  }, [open, editing])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    try {
      const data = {
        name: name.trim(), base_type: baseType, prefix,
        numbering_method: numbering, restart_yearly: restartYearly,
        default_narration: defaultNarration, is_active: active,
      }
      if (editing) await updateVoucherTypeProfile(editing.id, data)
      else await createVoucherTypeProfile(data)
      toast.success(editing ? 'Updated' : 'Created')
      onSaved()
      onOpenChange(false)
    } catch (err) {
      const e = err as { response?: { data?: Record<string, unknown> } }
      toast.error(JSON.stringify(e.response?.data ?? 'Failed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 animate-fadeIn" style={{ background: 'rgba(12,30,37,0.45)' }} />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 w-[92vw] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl p-5 animate-slideUp max-h-[85dvh] overflow-y-auto"
          style={{ background: 'var(--surface-0)', border: '1px solid var(--line)', boxShadow: '0 12px 40px rgba(0,0,0,0.18)' }}
        >
          <div className="flex items-start justify-between mb-3">
            <Dialog.Title className="text-base font-semibold" style={{ color: 'var(--ink)' }}>
              {editing ? `Edit ${editing.name}` : 'New Voucher Type'}
            </Dialog.Title>
            <Dialog.Close className="p-1 rounded hover:bg-[var(--color-hover-bg)]" aria-label="Close">
              <X className="w-4 h-4" style={{ color: 'var(--ink-3)' }} />
            </Dialog.Close>
          </div>
          <form onSubmit={submit} className="space-y-3">
            <Field label="Name" required hint="Shown in voucher dropdowns">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Cash Sales" autoFocus />
            </Field>
            <Field label="Base Type" required>
              <select
                value={baseType}
                onChange={(e) => setBaseType(e.target.value)}
                className="w-full h-9 px-3 text-sm border rounded-md outline-none focus:shadow-[0_0_0_3px_rgba(15,157,154,0.18)]"
                style={{ backgroundColor: 'var(--surface-0)', borderColor: 'var(--line)', color: 'var(--ink)' }}
              >
                {voucherList.map((v) => (
                  <option key={v.type} value={v.type}>{v.label} ({v.fKey})</option>
                ))}
              </select>
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Prefix" hint="e.g. CS- → CS-2026-000001">
                <Input value={prefix} onChange={(e) => setPrefix(e.target.value)} className="font-mono" />
              </Field>
              <Field label="Numbering">
                <select
                  value={numbering}
                  onChange={(e) => setNumbering(e.target.value as 'AUTO' | 'MANUAL')}
                  className="w-full h-9 px-3 text-sm border rounded-md outline-none focus:shadow-[0_0_0_3px_rgba(15,157,154,0.18)]"
                style={{ backgroundColor: 'var(--surface-0)', borderColor: 'var(--line)', color: 'var(--ink)' }}
                >
                  <option value="AUTO">Auto</option>
                  <option value="MANUAL">Manual</option>
                </select>
              </Field>
            </div>
            <Field label="Default narration">
              <Input value={defaultNarration} onChange={(e) => setDefaultNarration(e.target.value)} />
            </Field>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={restartYearly} onChange={(e) => setRestartYearly(e.target.checked)} />
                Restart yearly
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
                Active
              </label>
            </div>
            <div className="flex justify-end gap-2 pt-3 border-t mt-4" style={{ borderColor: 'var(--line)' }}>
              <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={saving}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 size={14} className="animate-spin" />} Save
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function Field({ label, required, hint, children }: { label: string; required?: boolean; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium mb-1" style={{ color: 'var(--ink-2)' }}>
        {label} {required && <span style={{ color: 'var(--danger)' }}>*</span>}
      </span>
      {children}
      {hint && <span className="block text-[11px] mt-1" style={{ color: 'var(--ink-3)' }}>{hint}</span>}
    </label>
  )
}
