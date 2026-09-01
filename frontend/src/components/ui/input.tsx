import * as React from 'react'
import { cn } from '../../lib/utils'

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /**
   * Select the contents when the field takes focus, so the next keystroke
   * replaces the value instead of appending to it.
   *
   * Defaults to true for numeric fields, which is where it matters: keying
   * over an amount is the normal way to correct one, and landing with a caret
   * at position 0 meant reaching for Ctrl+A first, every time. Text fields
   * keep the browser default — there, focus usually means "continue editing".
   */
  selectOnFocus?: boolean
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, style, selectOnFocus, onFocus, onKeyDown, inputMode, ...props }, ref) => {
    const numeric = type === 'number' || inputMode === 'decimal' || inputMode === 'numeric'
    const shouldSelect = selectOnFocus ?? numeric

    return (
      <input
        type={type}
        inputMode={inputMode}
        className={cn(
          'w-full h-9 px-3 text-sm rounded-md border placeholder:text-[var(--ink-3)] outline-none transition-colors',
          'focus:border-[var(--ink)] focus:shadow-[0_0_0_3px_rgba(15,157,154,0.18)]',
          className
        )}
        style={{
          backgroundColor: 'var(--surface-0)',
          borderColor: 'var(--line)',
          color: 'var(--ink)',
          ...style,
        }}
        onFocus={(e) => {
          if (shouldSelect) e.currentTarget.select()
          onFocus?.(e)
        }}
        onKeyDown={(e) => {
          onKeyDown?.(e)
          if (e.defaultPrevented || e.key !== 'Escape') return
          // Escape in a field means "leave the field" — the first half of the
          // app-wide Escape contract that useEscapeBack implements for pages.
          // A non-empty field clears first and swallows the key, so one Escape
          // abandons a half-typed filter without also abandoning the screen; a
          // second (now on an empty field) blurs and bubbles up to the page.
          const el = e.currentTarget
          if (el.value !== '' && !props.readOnly) {
            e.stopPropagation()
            // Set through the native setter so React's onChange still fires —
            // assigning `el.value` directly leaves component state stale.
            const setter = Object.getOwnPropertyDescriptor(
              window.HTMLInputElement.prototype,
              'value',
            )?.set
            setter?.call(el, '')
            el.dispatchEvent(new Event('input', { bubbles: true }))
          } else {
            el.blur()
          }
        }}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = 'Input'

export { Input }
