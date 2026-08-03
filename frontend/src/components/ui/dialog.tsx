import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from '../../lib/utils'

const Dialog = DialogPrimitive.Root
const DialogTrigger = DialogPrimitive.Trigger
const DialogPortal = DialogPrimitive.Portal
const DialogClose = DialogPrimitive.Close

const DialogOverlay = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      'fixed inset-0 z-40 bg-black/40 dark:bg-black/60 animate-fade-in',
      className
    )}
    {...props}
  />
))
DialogOverlay.displayName = 'DialogOverlay'

const DialogContent = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { description?: string }
>(({ className, children, style, description, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        // `w-[calc(100%-1.5rem)]` keeps a 12px gutter on either side at phone
        // widths, where a plain `w-full` dialog would run edge to edge.
        // `max-h-[85dvh]` accounts for mobile browser chrome that `vh` ignores.
        'fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[calc(100%-1.5rem)] max-w-md rounded-xl border shadow-lg p-4 sm:p-6 animate-slide-up max-h-[85dvh] overflow-y-auto overscroll-contain',
        className
      )}
      style={{
        backgroundColor: 'var(--surface-0)',
        borderColor: 'var(--line)',
        color: 'var(--ink)',
        ...style,
      }}
      {...props}
    >
      {/* Radix requires a description for a11y; render a screen-reader-only one
          so consumers don't have to (pass `description` for a meaningful label). */}
      <DialogPrimitive.Description className="sr-only">
        {description ?? 'Dialog'}
      </DialogPrimitive.Description>
      {children}
    </DialogPrimitive.Content>
  </DialogPortal>
))
DialogContent.displayName = 'DialogContent'

const DialogHeader = ({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn('flex items-center justify-between mb-5', className)}
    {...props}
  >
    {children}
    <DialogClose
      className="transition-colors hover:opacity-80"
      style={{ color: 'var(--ink-3)' }}
    >
      <X size={18} />
    </DialogClose>
  </div>
)

const DialogTitle = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, style, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn('text-base font-semibold', className)}
    style={{ color: 'var(--ink)', ...style }}
    {...props}
  />
))
DialogTitle.displayName = 'DialogTitle'

export {
  Dialog,
  DialogTrigger,
  DialogPortal,
  DialogClose,
  DialogOverlay,
  DialogContent,
  DialogHeader,
  DialogTitle,
}
