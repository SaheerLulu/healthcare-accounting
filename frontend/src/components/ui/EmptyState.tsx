import type { LucideIcon } from 'lucide-react'
import { PackageOpen, SearchX, BellOff, AlertCircle } from 'lucide-react'

type EmptyVariant = 'no-data' | 'no-results' | 'no-notifications' | 'error'

const variantDefaults: Record<EmptyVariant, { icon: LucideIcon; title: string; description: string }> = {
  'no-data': {
    icon: PackageOpen,
    title: 'No data yet',
    description: 'Data will appear here once available.',
  },
  'no-results': {
    icon: SearchX,
    title: 'No results found',
    description: 'Try adjusting your search or filters.',
  },
  'no-notifications': {
    icon: BellOff,
    title: 'All caught up',
    description: 'No notifications at the moment.',
  },
  error: {
    icon: AlertCircle,
    title: 'Something went wrong',
    description: 'Please try again or contact support.',
  },
}

interface EmptyStateProps {
  variant?: EmptyVariant
  icon?: LucideIcon
  title?: string
  description?: string
  actionLabel?: string
  onAction?: () => void
}

export function EmptyState({
  variant = 'no-data',
  icon,
  title,
  description,
  actionLabel,
  onAction,
}: EmptyStateProps) {
  const defaults = variantDefaults[variant]
  const Icon = icon || defaults.icon
  const displayTitle = title || defaults.title
  const displayDesc = description || defaults.description

  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 animate-fadeIn">
      <div
        className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
        style={{ backgroundColor: 'rgba(15, 157, 154, 0.08)' }}
      >
        <Icon className="w-8 h-8" style={{ color: 'var(--ink-3)' }} />
      </div>
      <h3 className="text-base font-semibold mb-1" style={{ color: 'var(--ink)' }}>
        {displayTitle}
      </h3>
      <p className="text-sm max-w-xs text-center" style={{ color: 'var(--ink-2)' }}>
        {displayDesc}
      </p>
      {actionLabel && onAction && (
        <button
          onClick={onAction}
          className="mt-4 px-4 py-2 rounded-lg text-sm font-medium text-white hover:opacity-90"
          style={{ backgroundColor: 'var(--brand)' }}
        >
          {actionLabel}
        </button>
      )}
    </div>
  )
}
