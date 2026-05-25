import { forwardRef } from 'react'
import { cn } from '../../lib/utils'

interface SwitchProps {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
  /** Optional id so a sibling <label htmlFor=...> can target it. */
  id?: string
  /** Aria label when there's no visible <label>. */
  'aria-label'?: string
}

/**
 * Brand-styled boolean toggle. Visually a pill with a sliding thumb, but
 * implemented as a plain accessible button so it picks up the app's focus
 * ring (`focus:shadow-[0_0_0_3px_rgba(15,157,154,0.18)]`) and respects
 * `prefers-reduced-motion` via CSS variables.
 */
export const Switch = forwardRef<HTMLButtonElement, SwitchProps>(function Switch(
  { checked, onCheckedChange, disabled = false, id, 'aria-label': ariaLabel },
  ref,
) {
  return (
    <button
      ref={ref}
      id={id}
      role="switch"
      type="button"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'relative inline-flex h-5 w-9 items-center rounded-full transition-colors outline-none',
        'focus:shadow-[0_0_0_3px_rgba(15,157,154,0.18)]',
        disabled && 'opacity-50 cursor-not-allowed',
      )}
      style={{
        background: checked ? 'var(--brand)' : 'var(--surface-1)',
        border: `1px solid ${checked ? 'var(--brand)' : 'var(--line)'}`,
      }}
    >
      <span
        className="inline-block h-3.5 w-3.5 rounded-full transition-transform"
        style={{
          background: '#fff',
          transform: checked ? 'translateX(18px)' : 'translateX(2px)',
          boxShadow: '0 1px 2px rgba(0,0,0,0.18)',
        }}
      />
    </button>
  )
})
