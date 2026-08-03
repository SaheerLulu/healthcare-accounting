import { ChevronLeft, ChevronRight } from 'lucide-react'

interface Props {
  page: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
  onPageSizeChange?: (size: number) => void
  pageSizeOptions?: number[]
}

export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 25, 50, 100],
}: Props) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1
  const end = Math.min(page * pageSize, total)

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 pt-3">
      <div className="flex items-center gap-3 text-sm" style={{ color: 'var(--ink-2)' }}>
        <span className="mono">
          {start}–{end}
        </span>
        <span>of</span>
        <span className="mono">{total.toLocaleString()}</span>
        {onPageSizeChange && (
          <>
            <span className="hidden sm:inline">·</span>
            <label className="hidden sm:flex items-center gap-2">
              <span className="text-xs uppercase tracking-wide" style={{ color: 'var(--ink-3)' }}>
                Rows
              </span>
              <select
                value={pageSize}
                onChange={(e) => onPageSizeChange(Number(e.target.value))}
                className="h-8 rounded-md text-sm px-2 outline-none"
                style={{
                  border: '1px solid var(--line)',
                  background: 'var(--surface-0)',
                  color: 'var(--ink)',
                }}
              >
                {pageSizeOptions.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
      </div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          className="h-9 w-9 sm:h-8 sm:w-8 rounded-md flex items-center justify-center disabled:opacity-40 hover:bg-[var(--color-hover-bg)]"
          style={{ border: '1px solid var(--line)', color: 'var(--ink-2)' }}
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span className="px-3 text-sm mono" style={{ color: 'var(--ink)' }}>
          {page} / {totalPages}
        </span>
        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          className="h-9 w-9 sm:h-8 sm:w-8 rounded-md flex items-center justify-center disabled:opacity-40 hover:bg-[var(--color-hover-bg)]"
          style={{ border: '1px solid var(--line)', color: 'var(--ink-2)' }}
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
