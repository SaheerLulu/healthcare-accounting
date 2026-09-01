import * as React from 'react'
import { cn } from '../../lib/utils'

/**
 * Table — matches parent Biloop striped table pattern.
 * Use <Table> which automatically applies `table-striped` (defined in
 * index.css) — alternating rows get stripe bg, hover rows get the teal
 * accent bar on the left edge.
 *
 * Every table ships inside a `.table-scroll` rail so narrow viewports
 * scroll the columns sideways instead of squeezing them. Accounting
 * tables are not reflowed into stacked cards — the column alignment is
 * what makes debits, credits and balances readable at a glance.
 * `wrapperClassName` styles that rail (e.g. a max-height for a long
 * register); `className` still lands on the <table> itself.
 *
 * Keyboard: the rail becomes a real focus stop — `tabIndex={0}` plus
 * `role="region"` — but ONLY while it actually overflows. A wide register
 * whose right-hand columns sit past the edge is otherwise unreachable
 * without a pointer: rows are focusable (see useListKeyboardNav) but the
 * arrow keys move the row, not the viewport, and nothing else in the rail
 * takes focus. Gating on the measurement matters just as much as the
 * affordance — making every table a permanent extra Tab stop would tax
 * every screen for the benefit of the few that scroll. Pass `label` to
 * name the region; without one it is announced generically.
 */
const Table = React.forwardRef<
  HTMLTableElement,
  React.HTMLAttributes<HTMLTableElement> & {
    wrapperClassName?: string
    /** Accessible name for the scroll rail, e.g. "Journal entries". */
    label?: string
  }
>(({ className, wrapperClassName, label, ...props }, ref) => {
  const railRef = React.useRef<HTMLDivElement>(null)
  const [scrollable, setScrollable] = React.useState(false)

  React.useEffect(() => {
    const el = railRef.current
    if (!el) return
    const measure = () =>
      setScrollable(el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    const table = el.querySelector('table')
    if (table) ro.observe(table)
    return () => ro.disconnect()
  }, [])

  // Only a rail that actually scrolls earns a Tab stop.
  const railProps: React.HTMLAttributes<HTMLDivElement> = scrollable
    ? {
        tabIndex: 0,
        role: 'region',
        'aria-label': label ? `${label} — scrollable table` : 'Scrollable table',
      }
    : {}

  return (
    <div
      ref={railRef}
      className={cn(
        'table-scroll',
        // The rail only takes focus when it scrolls, so the ring only ever
        // appears where it means something.
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--brand)]',
        wrapperClassName,
      )}
      {...railProps}
    >
      <table
        ref={ref}
        className={cn('w-full text-sm table-striped', className)}
        {...props}
      />
    </div>
  )
})
Table.displayName = 'Table'

const Thead = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => (
    <thead
      ref={ref}
      className={cn('sticky top-0 z-10 border-b', className)}
      style={{ backgroundColor: 'var(--color-grey-light)', borderColor: 'var(--color-card-border)' }}
      {...props}
    />
  )
)
Thead.displayName = 'Thead'

const Tbody = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => (
    <tbody ref={ref} className={cn('', className)} {...props} />
  )
)
Tbody.displayName = 'Tbody'

const Tfoot = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => (
    <tfoot
      ref={ref}
      className={cn('border-t font-medium', className)}
      style={{ borderColor: 'var(--color-card-border)', backgroundColor: 'var(--color-grey-light)' }}
      {...props}
    />
  )
)
Tfoot.displayName = 'Tfoot'

/**
 * A row that opens something spreads `useListKeyboardNav`'s `rowProps` here —
 * that is what supplies `role`, the roving `tabIndex`, the Enter/Space handler
 * and `data-kbd-row`, which index.css turns into the focus rail. The two data
 * attributes are named in the type so the contract is visible from the
 * primitive rather than only from the hook.
 */
export type TrProps = React.HTMLAttributes<HTMLTableRowElement> & {
  'data-kbd-row'?: number | string
  'data-active'?: string
}

const Tr = React.forwardRef<HTMLTableRowElement, TrProps>(
  ({ className, ...props }, ref) => (
    <tr
      ref={ref}
      className={cn('border-b', className)}
      style={{ borderColor: 'var(--color-card-border)' }}
      {...props}
    />
  )
)
Tr.displayName = 'Tr'

const Th = React.forwardRef<HTMLTableCellElement, React.ThHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => (
    <th
      ref={ref}
      className={cn('text-left px-4 h-10 text-xs font-semibold uppercase tracking-wide whitespace-nowrap', className)}
      style={{ color: 'var(--color-text-secondary)' }}
      {...props}
    />
  )
)
Th.displayName = 'Th'

const Td = React.forwardRef<HTMLTableCellElement, React.TdHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => (
    <td
      ref={ref}
      className={cn('py-2.5 px-4 whitespace-nowrap', className)}
      style={{ color: 'var(--color-text-primary)' }}
      {...props}
    />
  )
)
Td.displayName = 'Td'

export { Table, Thead, Tbody, Tfoot, Tr, Th, Td }
