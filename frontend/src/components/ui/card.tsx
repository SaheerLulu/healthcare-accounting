import * as React from 'react'
import { cn } from '../../lib/utils'

/**
 * Card — matches the parent Biloop design language:
 *   bg-[var(--color-card-bg)] rounded-xl card-shadow
 * Default padding p-6; override with className when a custom inset is needed.
 */
const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('rounded-xl p-6 card-shadow', className)}
      {...props}
    />
  )
)
Card.displayName = 'Card'

const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('-mx-6 -mt-6 mb-6 px-6 py-4 border-b', className)}
      style={{ borderColor: 'var(--color-card-border)' }}
      {...props}
    />
  )
)
CardHeader.displayName = 'CardHeader'

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('', className)}
      {...props}
    />
  )
)
CardContent.displayName = 'CardContent'

export { Card, CardHeader, CardContent }
