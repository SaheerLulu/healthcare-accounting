import * as React from 'react'
import { cn } from '../../lib/utils'

const Table = React.forwardRef<HTMLTableElement, React.HTMLAttributes<HTMLTableElement>>(
  ({ className, ...props }, ref) => (
    <table
      ref={ref}
      className={cn('w-full text-sm', className)}
      {...props}
    />
  )
)
Table.displayName = 'Table'

const Thead = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => (
    <thead ref={ref} className={cn('', className)} {...props} />
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
    <tfoot ref={ref} className={cn('', className)} {...props} />
  )
)
Tfoot.displayName = 'Tfoot'

const Tr = React.forwardRef<HTMLTableRowElement, React.HTMLAttributes<HTMLTableRowElement>>(
  ({ className, ...props }, ref) => (
    <tr
      ref={ref}
      className={cn(
        'border-b border-slate-100 transition-colors hover:bg-slate-50',
        className
      )}
      {...props}
    />
  )
)
Tr.displayName = 'Tr'

const Th = React.forwardRef<HTMLTableCellElement, React.ThHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => (
    <th
      ref={ref}
      className={cn(
        'py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wide text-left',
        className
      )}
      {...props}
    />
  )
)
Th.displayName = 'Th'

const Td = React.forwardRef<HTMLTableCellElement, React.TdHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => (
    <td
      ref={ref}
      className={cn('py-2.5 px-4 text-slate-900', className)}
      {...props}
    />
  )
)
Td.displayName = 'Td'

export { Table, Thead, Tbody, Tfoot, Tr, Th, Td }
