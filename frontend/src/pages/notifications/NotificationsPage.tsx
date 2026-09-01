import { useEffect, useRef, useState } from 'react'
import { Bell, CheckCheck, BellOff, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Link, useNavigate } from 'react-router-dom'
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
import { Switch } from '../../components/ui/switch'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { usePageKeyboard } from '../../hooks/usePageKeyboard'
import { useListKeyboardNav } from '../../hooks/useListKeyboardNav'

const PRIORITY_VARIANT: Record<string, 'default' | 'success' | 'error' | 'warning'> = {
  low: 'default', normal: 'default', high: 'warning', critical: 'error',
}

type Tab = 'unread' | 'all' | 'preferences'

export default function NotificationsPage() {
  const [items, setItems] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('unread')
  const navigate = useNavigate()
  const [confirmAll, setConfirmAll] = useState(false)
  const [markingAll, setMarkingAll] = useState(false)
  // Set when an action removed the focused card, so the effect below can put
  // focus back on whatever slid into its place.
  const refocusRef = useRef(false)
  // Where focus goes when that "whatever" is nothing — see the effect below.
  const emptyRef = useRef<HTMLDivElement>(null)

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

  const inbox = tab !== 'preferences'

  // ─── Keyboard ──────────────────────────────────────────────────────────────
  // The inbox is a stack of Cards — divs, so unreachable without a pointer.
  // Roving tabindex gives it ↑↓ / Home / End / PgUp / PgDn with a single tab
  // stop for the whole list. No onActivate: a card is not itself a target —
  // it was never clickable, and only some notifications carry a link_url, so
  // an Enter handler would announce every card as a button and then do nothing
  // for most of them. The card's own "View →" link and "Mark read" button are
  // the actions, one Tab away from the focused card.
  const list = useListKeyboardNav({ count: items.length })

  async function markOne(id: number) {
    try {
      // Marking read drops the item off the Unread tab, which unmounts the
      // button that was focused. Ask for focus to land on its replacement.
      refocusRef.current = true
      await markNotificationRead(id)
      await load()
    } catch { toast.error('Failed') }
  }

  // Bulk, server-side and one-way: there is no unmark-all, so this wipes the
  // whole "what have I not looked at yet" queue for good. Both routes in (the
  // button and the chord) go through the confirm below rather than writing on
  // a single keystroke.
  async function markAll() {
    // No refocus request here: the "Mark all read" button itself survives the
    // refresh, so moving focus into the list would take it away from the
    // control the user just pressed.
    setMarkingAll(true)
    try {
      const r = await markAllNotificationsRead()
      toast.success(`${r.marked_read} marked read`)
      setConfirmAll(false)
      await load()
    } catch { toast.error('Failed') }
    finally { setMarkingAll(false) }
  }

  useEffect(() => {
    if (!refocusRef.current) return
    refocusRef.current = false
    // Marking the LAST unread item read unmounts the list along with the
    // button that had focus, so there is no card to land on; without the else
    // branch focus falls to <body> and the next Tab restarts at the top of the
    // document, walking the whole sidebar again.
    if (items.length > 0) list.focusList()
    else emptyRef.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items])

  usePageKeyboard({
    actions: [
      // NOT Alt+A: everywhere else in the app that chord adds a line to a
      // voucher, so an operator's Alt+A reflex is "add", not "wipe my inbox" —
      // and it is not a list chord in the canonical map at all.
      { chord: 'Alt+M', label: 'Mark all read', run: () => setConfirmAll(true), when: inbox },
      { chord: 'Alt+R', label: 'Refresh', run: load, when: inbox },
      { chord: 'Alt+1', label: 'Unread', run: () => setTab('unread') },
      { chord: 'Alt+2', label: 'All', run: () => setTab('all') },
      { chord: 'Alt+3', label: 'Preferences', run: () => setTab('preferences') },
    ],
    onFocusList: inbox ? list.focusList : undefined,
    onBack: () => navigate(-1),
  })

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between sm:gap-4">
        <div>
          <h1 className="text-lg sm:text-xl font-semibold flex items-center gap-2"
              style={{ color: 'var(--ink)', letterSpacing: '-0.01em' }}>
            <Bell size={20} /> Notifications
          </h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--ink-2)' }}>
            {tab === 'preferences'
              ? 'Mute notification kinds you don\'t want to see.'
              : <><span className="mono">{items.length}</span> in view</>}
          </p>
        </div>
        {inbox && (
          <Button variant="secondary" onClick={() => setConfirmAll(true)}>
            <CheckCheck size={16} /> Mark all read
            <kbd className="hidden md:inline mono text-[10px] ml-1" style={{ color: 'var(--ink-3)' }}>Alt+M</kbd>
          </Button>
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

        {inbox && (
          <TabsContent value={tab}>
            {loading ? <SkeletonTable /> : items.length === 0 ? (
              // tabIndex -1: not a tab stop, but a place the refocus effect can
              // put the cursor when the last card it was holding disappears.
              <div ref={emptyRef} tabIndex={-1} className="focus:outline-none">
                <EmptyState title="All caught up" description="No notifications in this view." />
              </div>
            ) : (
              <div className="space-y-2" {...list.containerProps}>
                {items.map((n, i) => (
                  <Card
                    key={n.id}
                    className={`p-4 ${n.is_read ? 'opacity-60' : ''}`}
                    aria-label={n.title}
                    {...list.rowProps(i)}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2 mb-1">
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
                        <Button
                          size="sm"
                          variant="ghost"
                          className="flex-shrink-0"
                          onClick={() => markOne(n.id)}
                        >Mark read</Button>
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

      <ConfirmDialog
        open={confirmAll}
        onOpenChange={(o: boolean) => { if (!markingAll) setConfirmAll(o) }}
        title="Mark every notification read?"
        description="This clears the unread queue for your account in one go. There is no unmark-all — anything you have not looked at yet stops standing out."
        confirmLabel="Mark all read"
        cancelLabel="Cancel"
        loading={markingAll}
        onConfirm={() => { if (!markingAll) markAll() }}
      />
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
      <div className="px-4 sm:px-5 py-3 border-b" style={{ borderColor: 'var(--line)', background: 'var(--surface-1)' }}>
        <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>Notification kinds</h2>
        <p className="text-xs mt-0.5" style={{ color: 'var(--ink-3)' }}>
          Muted kinds disappear from the bell and the inbox. Other users (and other
          devices for the same account) are unaffected — preferences are per-user.
        </p>
      </div>
      <ul className="divide-y" style={{ borderColor: 'var(--line)' }}>
        {rows.map((r) => (
          <li key={r.kind} className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3"
              style={{ borderColor: 'var(--line)' }}>
            <div className="min-w-0">
              <div className="text-sm font-medium" style={{ color: 'var(--ink)' }}>{r.label}</div>
              <div className="text-xs mono break-all" style={{ color: 'var(--ink-3)' }}>{r.kind}</div>
            </div>
            <div className="inline-flex items-center gap-2.5 flex-shrink-0">
              <span className="text-xs" style={{ color: r.muted ? 'var(--ink-3)' : 'var(--ink-2)' }}>
                {r.muted ? 'Muted' : 'Active'}
              </span>
              <Switch
                checked={!r.muted}
                disabled={saving === r.kind}
                onCheckedChange={(active) => toggle(r.kind, !active)}
                aria-label={`Toggle ${r.label}`}
              />
            </div>
          </li>
        ))}
      </ul>
    </Card>
  )
}
