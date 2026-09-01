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
  // `ring-offset-2` draws its halo in Tailwind's default white, which on a
  // dark surface reads as a bright band around the button rather than a gap.
  // The theme lives in CSS variables the ring utilities do not read, so the
  // offset colour has to be named explicitly.
  'inline-flex items-center justify-center gap-2 rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-0)] disabled:opacity-60 disabled:pointer-events-none',
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
  /**
   * The chord that also runs this action, e.g. "Alt+N".
   *
   * Rendered as a trailing keycap and announced via `aria-keyshortcuts`, so
   * the binding is advertised at the control it belongs to instead of only in
   * the bottom hint bar. It does NOT bind the key — the screen still registers
   * it through usePageKeyboard, which is what puts it in the hint bar and the
   * F1 catalogue; this is the label half of that same contract.
   */
  chord?: string
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, style, chord, children, ...props }, ref) => {
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
        aria-keyshortcuts={chord}
        {...props}
      >
        {/* Slot requires EXACTLY ONE child — React.Children.only throws on an
            array, and `{children}{cond && <kbd/>}` is always an array of two
            even when the second element is `false`. So in asChild mode the
            child is passed through untouched and the keycap is dropped;
            `aria-keyshortcuts` above still advertises the chord. */}
        {asChild ? (
          children
        ) : (
          <>
            {children}
            {chord && (
              <kbd
                className="mono text-[10px] px-1 py-0.5 rounded hidden lg:inline-block"
                style={{
                  border: '1px solid currentColor',
                  opacity: 0.55,
                  lineHeight: 1.4,
                }}
              >
                {chord}
              </kbd>
            )}
          </>
        )}
      </Comp>
    )
  }
)
Button.displayName = 'Button'

export { Button, buttonVariants }
