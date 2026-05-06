import { useEffect, useState } from 'react'
import { Bell, CheckCheck } from 'lucide-react'
import { toast } from 'sonner'
import { Link } from 'react-router-dom'
import {
  listNotifications, markNotificationRead, markAllNotificationsRead,
  type Notification,
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

export default function NotificationsPage() {
  const [items, setItems] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'unread' | 'all'>('unread')

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
  useEffect(() => { load() }, [tab])

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2"
              style={{ color: 'var(--ink)', letterSpacing: '-0.01em' }}>
            <Bell size={20} /> Notifications
          </h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--ink-2)' }}>
            <span className="mono">{items.length}</span> in view
          </p>
        </div>
        <Button variant="secondary" onClick={async () => {
          try { const r = await markAllNotificationsRead(); toast.success(`${r.marked_read} marked read`); load() }
          catch { toast.error('Failed') }
        }}><CheckCheck size={16} /> Mark all read</Button>
      </div>

      <Tabs value={tab} onValueChange={(v: any) => setTab(v)}>
        <TabsList>
          <TabsTrigger value="unread">Unread</TabsTrigger>
          <TabsTrigger value="all">All</TabsTrigger>
        </TabsList>
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
      </Tabs>
    </div>
  )
}
