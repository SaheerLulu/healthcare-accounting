import { useCallback, useEffect, useRef, useState } from 'react'
import { Bell } from 'lucide-react'
import { Link } from 'react-router-dom'
import { getNotificationCounts } from '../../lib/api'

/** Header bell with adaptive polling:
 *   - 30s when there are unread notifications (user probably cares)
 *   - 5min when idle (inactive tab → 10x less server load)
 *   - Force-poll on tab focus so a user returning to the app sees fresh state.
 *
 * Net effect: ~10x fewer requests across a typical idle session vs. the
 * old fixed 60s cadence, with snappier updates when something happens.
 */
const ACTIVE_INTERVAL_MS = 30_000
const IDLE_INTERVAL_MS = 5 * 60_000

export default function NotificationBell() {
  const [count, setCount] = useState(0)
  const timerRef = useRef<number | null>(null)
  const countRef = useRef(0)

  const tick = useCallback(async () => {
    try {
      const r = await getNotificationCounts()
      setCount(r.unread_total)
      countRef.current = r.unread_total
    } catch { /* silent */ }
  }, [])

  const schedule = useCallback(() => {
    if (timerRef.current) window.clearTimeout(timerRef.current)
    const delay = countRef.current > 0 ? ACTIVE_INTERVAL_MS : IDLE_INTERVAL_MS
    timerRef.current = window.setTimeout(async () => {
      await tick()
      schedule()
    }, delay) as unknown as number
  }, [tick])

  useEffect(() => {
    // Initial fetch + schedule the next.
    tick().then(schedule)
    // When the user returns to the tab, refresh immediately and reset cadence.
    function onVisible() {
      if (document.visibilityState === 'visible') {
        tick().then(schedule)
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      if (timerRef.current) window.clearTimeout(timerRef.current)
    }
  }, [tick, schedule])

  // No chord is registered here. The bell renders on every screen, so a hotkey
  // bound in this component would be app-wide — and an app-wide chord has no
  // way to advertise itself: registerHints REPLACES the current page's hints,
  // so it would appear in neither the bottom bar nor the F1 catalogue, and it
  // would silently take a letter the page-scoped Alt+ range already uses
  // (Alt+B is "Pay bills", "Deposit cash" and "Bounce" on three screens). The
  // bell is a link in the header and stays reachable by Tab.
  return (
    <Link
      to="/notifications"
      className="relative flex-shrink-0 p-2.5 sm:p-2 rounded hover:bg-gray-100"
      aria-label={`Notifications (${count} unread)`}
    >
      <Bell size={18} />
      {count > 0 && (
        <span
          aria-hidden="true"
          className="absolute top-0.5 right-0.5 sm:-top-0.5 sm:-right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-medium flex items-center justify-center"
        >
          {count > 99 ? '99+' : count}
        </span>
      )}
      {/* The count changes on a background poll. Without a live region the only
          way to learn that something arrived is to go and look at the badge —
          which a keyboard-only or screen-reader user has no cheap way to do. */}
      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {count > 0 ? `${count} unread notifications` : 'No unread notifications'}
      </span>
    </Link>
  )
}
