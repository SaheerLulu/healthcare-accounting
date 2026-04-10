import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/utils'

/**
 * Button — matches the parent Biloop design language.
 * Uses CSS variables (--color-teal, etc.) via inline `style` to inherit
 * light/dark theme from index.css without needing Tailwind dark: variants.
 */
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-60 disabled:pointer-events-none',
  {
    variants: {
      variant: {
        primary: 'text-white hover:opacity-90 focus-visible:ring-teal-500',
        secondary:
          'border hover:bg-[var(--color-hover-bg)] focus-visible:ring-teal-500',
        ghost:
          'hover:bg-[var(--color-hover-bg)] focus-visible:ring-teal-500',
        destructive:
          'bg-red-600 hover:bg-red-700 text-white focus-visible:ring-red-500',
        link:
          'underline-offset-4 hover:underline focus-visible:ring-teal-500',
      },
      size: {
        sm: 'h-8 px-3 text-xs',
        default: 'h-9 px-4 py-2',
        lg: 'h-10 px-5 text-base',
        icon: 'h-9 w-9',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'default',
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, style, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'

    // Apply theme-var backgrounds via inline style so dark mode works via CSS vars
    const themeStyle: React.CSSProperties = { ...style }
    if (variant === 'primary' || variant === undefined) {
      themeStyle.backgroundColor = 'var(--color-teal)'
    } else if (variant === 'secondary') {
      themeStyle.backgroundColor = 'var(--color-card-bg)'
      themeStyle.borderColor = 'var(--color-card-border)'
      themeStyle.color = 'var(--color-text-primary)'
    } else if (variant === 'ghost') {
      themeStyle.color = 'var(--color-text-secondary)'
    } else if (variant === 'link') {
      themeStyle.color = 'var(--color-teal)'
    }

    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        style={themeStyle}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = 'Button'

export { Button, buttonVariants }
