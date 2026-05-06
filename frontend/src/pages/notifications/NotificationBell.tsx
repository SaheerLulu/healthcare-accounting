import { useEffect, useState } from 'react'
import { Bell } from 'lucide-react'
import { Link } from 'react-router-dom'
import { getNotificationCounts } from '../../lib/api'

/** Header bell that polls the unread count every 60s. */
export default function NotificationBell() {
  const [count, setCount] = useState(0)

  useEffect(() => {
    let cancelled = false
    async function tick() {
      try {
        const r = await getNotificationCounts()
        if (!cancelled) setCount(r.unread_total)
      } catch { /* silent */ }
    }
    tick()
    const t = setInterval(tick, 60000)
    return () => { cancelled = true; clearInterval(t) }
  }, [])

  return (
    <Link to="/notifications" className="relative p-2 rounded hover:bg-gray-100" aria-label={`Notifications (${count} unread)`}>
      <Bell size={18} />
      {count > 0 && (
        <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-medium flex items-center justify-center">
          {count > 99 ? '99+' : count}
        </span>
      )}
    </Link>
  )
}
