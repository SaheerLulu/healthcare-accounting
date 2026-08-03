import * as React from 'react'
import { cn } from '../../lib/utils'

/** Does the caller already dictate padding (`p-0`, `p-4`, `px-3`, …)? */
const OVERRIDES_PADDING = /(^|\s)-?p[xytrbles]?-/

const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      // The default inset tightens on phones, where 24px of card padding
      // inside a 12px page gutter leaves too little room for the content.
      // Skipped entirely when the caller sets its own padding — otherwise
      // an explicit `p-0` would survive only up to the sm breakpoint.
      className={cn(
        'rounded-xl card-shadow',
        !OVERRIDES_PADDING.test(className ?? '') && 'p-4 sm:p-6',
        className
      )}
      {...props}
    />
  )
)
Card.displayName = 'Card'

const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      // Negative margins must track the Card padding above, or the header
      // rule stops short of the card edge.
      className={cn(
        '-mx-4 sm:-mx-6 -mt-4 sm:-mt-6 mb-4 sm:mb-6 px-4 sm:px-6 py-3 sm:py-4 border-b flex flex-col gap-1',
        className
      )}
      style={{ borderColor: 'var(--line)' }}
      {...props}
    />
  )
)
CardHeader.displayName = 'CardHeader'

const CardTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3
      ref={ref}
      className={cn('text-base font-semibold leading-tight', className)}
      style={{ color: 'var(--ink)', letterSpacing: '-0.005em' }}
      {...props}
    />
  )
)
CardTitle.displayName = 'CardTitle'

const CardDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p
      ref={ref}
      className={cn('text-sm', className)}
      style={{ color: 'var(--ink-2)' }}
      {...props}
    />
  )
)
CardDescription.displayName = 'CardDescription'

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('', className)} {...props} />
  )
)
CardContent.displayName = 'CardContent'

const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        '-mx-4 sm:-mx-6 -mb-4 sm:-mb-6 mt-4 sm:mt-6 px-4 sm:px-6 py-3 sm:py-4 border-t flex flex-wrap items-center justify-end gap-2',
        className
      )}
      style={{ borderColor: 'var(--line)' }}
      {...props}
    />
  )
)
CardFooter.displayName = 'CardFooter'

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter }
