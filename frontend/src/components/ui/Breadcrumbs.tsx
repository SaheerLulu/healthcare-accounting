import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'

interface Crumb {
  label: string
  to?: string
}

interface Props {
  items: Crumb[]
  className?: string
}

export function Breadcrumbs({ items, className = '' }: Props) {
  return (
    <nav className={`flex items-center text-sm flex-wrap ${className}`} aria-label="Breadcrumb">
      {items.map((item, idx) => {
        const isLast = idx === items.length - 1
        return (
          <div key={idx} className="flex items-center">
            {idx > 0 && (
              <ChevronRight className="w-3.5 h-3.5 mx-1.5" style={{ color: 'var(--ink-3)' }} />
            )}
            {item.to && !isLast ? (
              <Link
                to={item.to}
                className="hover:underline"
                style={{ color: 'var(--ink-2)' }}
              >
                {item.label}
              </Link>
            ) : (
              <span style={{ color: isLast ? 'var(--ink)' : 'var(--ink-2)', fontWeight: isLast ? 500 : 400 }}>
                {item.label}
              </span>
            )}
          </div>
        )
      })}
    </nav>
  )
}
