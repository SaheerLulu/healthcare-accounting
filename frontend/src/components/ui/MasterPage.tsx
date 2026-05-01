import type { ReactNode } from 'react'
import { Plus, Search } from 'lucide-react'

interface MasterPageProps {
  title: string
  subtitle?: ReactNode
  searchValue?: string
  searchPlaceholder?: string
  onSearchChange?: (value: string) => void
  addLabel?: string
  onAdd?: () => void
  toolbar?: ReactNode
  children: ReactNode
  footer?: ReactNode
}

export function MasterPage({
  title,
  subtitle,
  searchValue,
  searchPlaceholder = 'Search…',
  onSearchChange,
  addLabel,
  onAdd,
  toolbar,
  children,
  footer,
}: MasterPageProps) {
  const showSearch = onSearchChange !== undefined
  const showAdd = !!(addLabel && onAdd)

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-semibold truncate" style={{ color: 'var(--ink)', letterSpacing: '-0.01em' }}>
            {title}
          </h1>
          {subtitle && (
            <p className="text-sm mt-0.5" style={{ color: 'var(--ink-2)' }}>
              {subtitle}
            </p>
          )}
        </div>

        {toolbar}

        {showSearch && (
          <div className="relative">
            <Search
              className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2"
              style={{ color: 'var(--ink-3)' }}
            />
            <input
              type="text"
              value={searchValue ?? ''}
              onChange={(e) => onSearchChange?.(e.target.value)}
              placeholder={searchPlaceholder}
              className="h-9 pl-8 pr-3 rounded-md text-sm outline-none transition-colors"
              style={{
                width: 260,
                border: '1px solid var(--line)',
                background: 'var(--surface-0)',
                color: 'var(--ink)',
              }}
              onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--ink)')}
              onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--line)')}
            />
          </div>
        )}

        {showAdd && (
          <button
            type="button"
            onClick={onAdd}
            className="h-9 px-3.5 rounded-md text-sm font-semibold text-white flex items-center gap-2 hover:opacity-90"
            style={{ background: 'var(--brand)' }}
          >
            <Plus className="w-4 h-4" />
            {addLabel}
          </button>
        )}
      </div>

      <div>{children}</div>

      {footer && <div>{footer}</div>}
    </div>
  )
}
