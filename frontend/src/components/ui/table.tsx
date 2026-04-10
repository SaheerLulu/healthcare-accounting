import * as React from 'react'
import { cn } from '../../lib/utils'

/**
 * Table — matches parent Biloop striped table pattern.
 * Use <Table> which automatically applies `table-striped` (defined in
 * index.css) — alternating rows get stripe bg, hover rows get the teal
 * accent bar on the left edge.
 */
const Table = React.forwardRef<HTMLTableElement, React.HTMLAttributes<HTMLTableElement>>(
  ({ className, ...props }, ref) => (
    <table
      ref={ref}
      className={cn('w-full text-sm table-striped', className)}
      {...props}
    />
  )
)
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

const Tr = React.forwardRef<HTMLTableRowElement, React.HTMLAttributes<HTMLTableRowElement>>(
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
