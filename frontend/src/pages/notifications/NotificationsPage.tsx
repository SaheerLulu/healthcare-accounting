import { useEffect, useState } from 'react'
import { Bell, CheckCheck, BellOff, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Link } from 'react-router-dom'
import {
  listNotifications, markNotificationRead, markAllNotificationsRead,
  listNotificationKindPrefs, setNotificationKindPref,
  type Notification, type NotificationKindPref,
} from '../../lib/api'
import { formatDate } from '../../lib/utils'
import { Button } from '../../components/ui/button'
import { Badge } from '../../components/ui/badge'
import { Card } from '../../components/ui/card'
import { EmptyState } from '../../components/ui/EmptyState'
import { SkeletonTable } from '../../components/ui/Skeletons'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../../components/ui/tabs'

const PRIORITY_VARIANT: Record<string, 'default' | 'success' | 'error' | 'warning'> = {
  low: 'default', normal: 'default', high: 'warning', critical: 'error',
}

type Tab = 'unread' | 'all' | 'preferences'

export default function NotificationsPage() {
  const [items, setItems] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('unread')

  async function load() {
    setLoading(true)
    try {
      const params: Record<string, string> = {}
      if (tab === 'unread') params.unread = 'true'
      const r = await listNotifications(params)
      setItems(Array.isArray(r) ? r : (r.results ?? []))
    } catch { toast.error('Failed to load notifications') }
    finally { setLoading(false) }
  }
  useEffect(() => {
    if (tab === 'preferences') return  // Preferences tab manages its own load.
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2"
              style={{ color: 'var(--ink)', letterSpacing: '-0.01em' }}>
            <Bell size={20} /> Notifications
          </h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--ink-2)' }}>
            {tab === 'preferences'
              ? 'Mute notification kinds you don\'t want to see.'
              : <><span className="mono">{items.length}</span> in view</>}
          </p>
        </div>
        {tab !== 'preferences' && (
          <Button variant="secondary" onClick={async () => {
            try { const r = await markAllNotificationsRead(); toast.success(`${r.marked_read} marked read`); load() }
            catch { toast.error('Failed') }
          }}><CheckCheck size={16} /> Mark all read</Button>
        )}
      </div>

      <Tabs value={tab} onValueChange={(v: string) => setTab(v as Tab)}>
        <TabsList>
          <TabsTrigger value="unread">Unread</TabsTrigger>
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="preferences">
            <BellOff size={12} className="mr-1" /> Preferences
          </TabsTrigger>
        </TabsList>

        {tab !== 'preferences' && (
          <TabsContent value={tab}>
            {loading ? <SkeletonTable /> : items.length === 0 ? (
              <EmptyState title="All caught up" description="No notifications in this view." />
            ) : (
              <div className="space-y-2">
                {items.map((n) => (
                  <Card key={n.id} className={`p-4 ${n.is_read ? 'opacity-60' : ''}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge variant={PRIORITY_VARIANT[n.priority] || 'default'}>{n.priority}</Badge>
                          <span className="text-xs" style={{ color: 'var(--ink-3)' }}>{n.kind}</span>
                          <span className="text-xs" style={{ color: 'var(--ink-3)' }}>· {formatDate(n.created_at.slice(0, 10))}</span>
                        </div>
                        <div className="font-medium" style={{ color: 'var(--ink)' }}>{n.title}</div>
                        {n.body && <div className="text-sm mt-1" style={{ color: 'var(--ink-2)' }}>{n.body}</div>}
                        {n.link_url && (
                          <Link to={n.link_url} className="text-sm mt-2 inline-block underline">View →</Link>
                        )}
                      </div>
                      {!n.is_read && (
                        <Button size="sm" variant="ghost" onClick={async () => {
                          try { await markNotificationRead(n.id); load() }
                          catch { toast.error('Failed') }
                        }}>Mark read</Button>
                      )}
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        )}

        <TabsContent value="preferences">
          <PreferencesPanel />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function PreferencesPanel() {
  const [rows, setRows] = useState<NotificationKindPref[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    try {
      const r = await listNotificationKindPrefs()
      setRows(r)
    } catch { toast.error('Failed to load preferences') }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  async function toggle(kind: string, muted: boolean) {
    setSaving(kind)
    try {
      await setNotificationKindPref(kind, muted)
      setRows((rs) => rs.map((r) => r.kind === kind ? { ...r, muted } : r))
      toast.success(muted ? `${kind} muted` : `${kind} unmuted`)
    } catch { toast.error('Failed to save preference') }
    finally { setSaving(null) }
  }

  if (loading) return (
    <div className="flex items-center justify-center h-40">
      <Loader2 size={20} className="animate-spin" style={{ color: 'var(--brand)' }} />
    </div>
  )

  return (
    <Card className="overflow-hidden p-0">
      <div className="px-5 py-3 border-b" style={{ borderColor: 'var(--line)', background: 'var(--surface-1)' }}>
        <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>Notification kinds</h2>
        <p className="text-xs mt-0.5" style={{ color: 'var(--ink-3)' }}>
          Muted kinds disappear from the bell and the inbox. Other users (and other
          devices for the same account) are unaffected — preferences are per-user.
        </p>
      </div>
      <ul className="divide-y" style={{ borderColor: 'var(--line)' }}>
        {rows.map((r) => (
          <li key={r.kind} className="flex items-center justify-between px-5 py-3"
              style={{ borderColor: 'var(--line)' }}>
            <div>
              <div className="text-sm font-medium" style={{ color: 'var(--ink)' }}>{r.label}</div>
              <div className="text-xs mono" style={{ color: 'var(--ink-3)' }}>{r.kind}</div>
            </div>
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <span className="text-xs" style={{ color: 'var(--ink-2)' }}>
                {r.muted ? 'Muted' : 'Active'}
              </span>
              <input
                type="checkbox"
                checked={!r.muted}
                disabled={saving === r.kind}
                onChange={(e) => toggle(r.kind, !e.target.checked)}
                className="w-9 h-5 rounded-full appearance-none relative cursor-pointer transition-colors"
                style={{
                  background: r.muted ? 'var(--surface-1)' : 'var(--brand)',
                  border: '1px solid var(--line)',
                }}
              />
            </label>
          </li>
        ))}
      </ul>
    </Card>
  )
}
