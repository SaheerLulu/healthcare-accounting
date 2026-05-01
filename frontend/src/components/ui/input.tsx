import * as React from 'react'
import { cn } from '../../lib/utils'

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, style, ...props }, ref) => {
    return (
      <input
        type={type}
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
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = 'Input'

export { Input }
