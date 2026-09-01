import { useEffect, useId, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react'

interface Props {
  page: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
  onPageSizeChange?: (size: number) => void
  pageSizeOptions?: number[]
}

/**
 * No chord is bound in here, deliberately. Pagination is a shared primitive
 * that can appear more than once on a screen, underneath whatever chords that
 * screen already owns, so a chord claimed from inside it would collide by
 * construction — and the app's chord map has no pagination entry to claim.
 * The keyboard route to an arbitrary page is local instead: type the number in
 * the page box (↑/↓ step it), or jump to either end with First / Last. Page 40
 * of a register used to cost 39 separate activations of the Next arrow.
 */
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
  const sizeId = useId()

  const atStart = page <= 1
  const atEnd = page >= totalPages

  // The box holds a draft while it is being typed in, and re-syncs whenever the
  // page moves underneath it — an arrow, a new filter, a page-size change that
  // shortens the run.
  const [draft, setDraft] = useState(String(page))
  // Set by Escape, consumed by the blur Escape itself performs: a half-typed
  // number is discarded on the way out of the field, not navigated to.
  const skipCommitRef = useRef(false)
  useEffect(() => {
    setDraft(String(page))
  }, [page])

  function go(next: number) {
    const clamped = Math.min(totalPages, Math.max(1, next))
    if (clamped !== page) onPageChange(clamped)
    setDraft(String(clamped))
  }

  function commitDraft() {
    if (skipCommitRef.current) {
      skipCommitRef.current = false
      setDraft(String(page))
      return
    }
    const n = Number(draft)
    if (!draft.trim() || !Number.isFinite(n)) {
      setDraft(String(page))
      return
    }
    go(Math.trunc(n))
  }

  // The boundary buttons stay in the document and in the tab order.
  // `disabled` would drop the button the user just pressed out of the tab
  // order the instant it took effect — activating Next on the second-to-last
  // page left focus on <body>, so the next Tab restarted from the top of the
  // page instead of continuing past the pager. `aria-disabled` says the same
  // thing to assistive tech while keeping focus where the user put it.
  const arrowClass =
    'h-9 w-9 sm:h-8 sm:w-8 rounded-md flex items-center justify-center hover:bg-[var(--color-hover-bg)] ' +
    'aria-disabled:opacity-40 aria-disabled:cursor-default ' +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]'

  return (
    <nav className="flex flex-wrap items-center justify-between gap-3 pt-3" aria-label="Pagination">
      <div className="flex items-center gap-3 text-sm" style={{ color: 'var(--ink-2)' }}>
        <span className="mono">
          {start}–{end}
        </span>
        <span>of</span>
        <span className="mono">{total.toLocaleString()}</span>
        {onPageSizeChange && (
          <>
            <span className="hidden sm:inline">·</span>
            <label className="hidden sm:flex items-center gap-2" htmlFor={sizeId}>
              <span className="text-xs uppercase tracking-wide" style={{ color: 'var(--ink-3)' }}>
                Rows
              </span>
              <select
                id={sizeId}
                value={pageSize}
                onChange={(e) => onPageSizeChange(Number(e.target.value))}
                // The UA ring was suppressed with nothing put back, so keyboard
                // focus on this control was invisible. Matches the Input primitive.
                className="h-8 rounded-md text-sm px-2 outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
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
          aria-disabled={atStart}
          aria-label="First page"
          onClick={() => go(1)}
          className={arrowClass}
          style={{ border: '1px solid var(--line)', color: 'var(--ink-2)' }}
        >
          <ChevronsLeft className="w-4 h-4" />
        </button>
        <button
          type="button"
          aria-disabled={atStart}
          aria-label="Previous page"
          onClick={() => go(page - 1)}
          className={arrowClass}
          style={{ border: '1px solid var(--line)', color: 'var(--ink-2)' }}
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <div className="flex items-center gap-1.5 px-1 text-sm mono" style={{ color: 'var(--ink)' }}>
          <input
            value={draft}
            inputMode="numeric"
            // The total is in the visible "/ n" beside the box, which is
            // aria-hidden so it is not read as a stray number — so the label
            // carries it instead. Tabbing in should say what the range is.
            aria-label={`Page number (of ${totalPages})`}
            onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, ''))}
            onFocus={(e) => e.currentTarget.select()}
            onBlur={commitDraft}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                commitDraft()
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                go(page + 1)
              } else if (e.key === 'ArrowDown') {
                e.preventDefault()
                go(page - 1)
              } else if (e.key === 'Escape') {
                // Escape means "leave the field" app-wide — useEscapeBack
                // blurs it and a second press goes back — so the event is left
                // to propagate. Blurring here as well keeps the discard flag
                // paired with the blur it was set for.
                skipCommitRef.current = true
                setDraft(String(page))
                e.currentTarget.blur()
              }
            }}
            className="h-9 sm:h-8 w-12 rounded-md text-sm mono text-center outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
            style={{
              border: '1px solid var(--line)',
              background: 'var(--surface-0)',
              color: 'var(--ink)',
            }}
          />
          <span aria-hidden="true">/ {totalPages}</span>
        </div>
        {/* Focus stays on the arrow while the page number changes underneath
            it, so the change has to be announced rather than seen. The box
            itself cannot be the live region — it is an editable field, and
            announcing every keystroke back is noise. */}
        <span className="sr-only" aria-live="polite" aria-atomic="true">
          Page {page} of {totalPages}
        </span>
        <button
          type="button"
          aria-disabled={atEnd}
          aria-label="Next page"
          onClick={() => go(page + 1)}
          className={arrowClass}
          style={{ border: '1px solid var(--line)', color: 'var(--ink-2)' }}
        >
          <ChevronRight className="w-4 h-4" />
        </button>
        <button
          type="button"
          aria-disabled={atEnd}
          aria-label="Last page"
          onClick={() => go(totalPages)}
          className={arrowClass}
          style={{ border: '1px solid var(--line)', color: 'var(--ink-2)' }}
        >
          <ChevronsRight className="w-4 h-4" />
        </button>
      </div>
    </nav>
  )
}
