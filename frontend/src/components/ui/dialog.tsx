import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from '../../lib/utils'
import { OverlayDepthProvider } from '../../contexts/HotkeyContext'

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
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    description?: string
    /**
     * Keyboard commit path for a dialog that holds a form: Ctrl+Enter and
     * Ctrl+S both run it from any field, so the primary button — always the
     * last stop in the DOM — never has to be Tabbed to. Bare Enter is left
     * to the browser: several dialogs here hold more than one field, and a
     * reflexive Enter mid-form should not submit them.
     */
    onSubmit?: () => void
  }
>(({ className, children, style, description, onSubmit, onKeyDown, ...props }, ref) => {
  const opener = React.useRef<HTMLElement | null>(null)
  return (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      onKeyDown={(e) => {
        onKeyDown?.(e)
        if (e.defaultPrevented || !onSubmit) return
        const isSave = (e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')
        const isCommit = (e.ctrlKey || e.metaKey) && e.key === 'Enter'
        if (isSave || isCommit) {
          e.preventDefault()
          // Keep the page's own Ctrl+S, behind the modal, out of it.
          e.stopPropagation()
          onSubmit()
        }
      }}
      // As in SheetContent: focus the dialog's entry field rather than the
      // close X that happens to be first in the DOM.
      /**
       * Restore focus to whatever opened this overlay.
       *
       * Radix's own close handler is `preventDefault(); triggerRef.current
       * ?.focus()`, which works only for a <Dialog.Trigger>. Almost every
       * overlay here is state-driven and opened from a button outside the
       * subtree, so triggerRef is null: the preventDefault cancels
       * FocusScope's restore and nothing replaces it, dropping focus on
       * <body>. For a keyboard-only user that means every confirm and every
       * edit panel ends with them Tabbing from the top of the document to
       * find their place again.
       *
       * Ours runs first (Radix composes the prop ahead of its own) and the
       * preventDefault stops Radix's null-trigger version running at all.
       */
      onCloseAutoFocus={(e) => {
        e.preventDefault()
        const el = opener.current
        if (el?.isConnected) el.focus()
      }}
      onOpenAutoFocus={(e) => {
        // Still the opener here — Radix has not moved focus yet.
        opener.current = document.activeElement as HTMLElement | null
        const root = e.currentTarget as HTMLElement
        const target =
          root.querySelector<HTMLElement>('[data-autofocus]') ??
          root.querySelector<HTMLElement>(
            'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled])',
          )
        if (target) {
          e.preventDefault()
          target.focus()
        }
      }}
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
      {/* Chords registered inside this dialog outrank the page's; the page's
          are suppressed while it is open. See OverlayDepthProvider. */}
      <OverlayDepthProvider>{children}</OverlayDepthProvider>
    </DialogPrimitive.Content>
  </DialogPortal>
  )
})
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
      className="transition-colors hover:opacity-80 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
      style={{ color: 'var(--ink-3)' }}
      aria-label="Close"
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
