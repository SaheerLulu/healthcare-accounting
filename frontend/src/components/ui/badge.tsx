import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/utils'

const badgeVariants = cva(
  'inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium capitalize whitespace-nowrap',
  {
    variants: {
      variant: {
        default: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
        success: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400',
        warning: 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-400',
        error: 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-400',
        info: 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-400',
        primary: 'bg-teal-50 text-teal-700 dark:bg-teal-950 dark:text-teal-300',
        purple: 'bg-purple-50 text-purple-700 dark:bg-purple-950 dark:text-purple-400',
        orange: 'bg-orange-50 text-orange-700 dark:bg-orange-950 dark:text-orange-400',
        outline: 'border bg-transparent',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, style, ...props }: BadgeProps) {
  const outlineStyle =
    variant === 'outline'
      ? { borderColor: 'var(--line)', color: 'var(--ink-2)', ...style }
      : style
  return (
    <span
      className={cn(badgeVariants({ variant, className }))}
      style={outlineStyle}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
