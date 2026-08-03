interface SkeletonProps {
  className?: string
  width?: number | string
  height?: number | string
}

export function Skeleton({ className = '', width, height }: SkeletonProps) {
  return (
    <div
      className={`rounded animate-shimmer ${className}`}
      style={{ width, height: height ?? 12 }}
    />
  )
}

export function SkeletonCard() {
  return (
    <div className="rounded-xl p-4 card-shadow space-y-3">
      <div className="flex items-center gap-2">
        <Skeleton width={32} height={32} className="rounded-lg" />
        <Skeleton width={120} height={10} />
      </div>
      <Skeleton width={100} height={24} />
      <Skeleton width={60} height={10} />
    </div>
  )
}

export function SkeletonTable({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="rounded-xl card-shadow overflow-hidden">
      <div
        className="flex border-b px-4 h-10 items-center gap-4"
        style={{ background: 'var(--color-grey-light)', borderColor: 'var(--line)' }}
      >
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} width={`${80 / cols}%`} height={10} />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex border-b px-4 h-12 items-center gap-4"
          style={{ borderColor: 'var(--line)' }}
        >
          {Array.from({ length: cols }).map((_, j) => (
            <Skeleton key={j} width={`${80 / cols}%`} height={10} />
          ))}
        </div>
      ))}
    </div>
  )
}

export function SkeletonForm() {
  return (
    <div className="space-y-4 rounded-xl p-4 sm:p-6 card-shadow">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="space-y-1.5">
          <Skeleton width={80} height={10} />
          <Skeleton width="100%" height={36} className="rounded-md" />
        </div>
      ))}
    </div>
  )
}
