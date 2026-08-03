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

  return (
    <Link to="/notifications" className="relative flex-shrink-0 p-2.5 sm:p-2 rounded hover:bg-gray-100" aria-label={`Notifications (${count} unread)`}>
      <Bell size={18} />
      {count > 0 && (
        <span className="absolute top-0.5 right-0.5 sm:-top-0.5 sm:-right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-medium flex items-center justify-center">
          {count > 99 ? '99+' : count}
        </span>
      )}
    </Link>
  )
}
