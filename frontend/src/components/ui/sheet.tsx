import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from '../../lib/utils'
import { OverlayDepthProvider } from '../../contexts/HotkeyContext'

/**
 * Sheet — right-anchored slide-in panel built on Radix Dialog.
 * For Zoho-style edit/create forms that don't disrupt the underlying view.
 */
const Sheet = DialogPrimitive.Root
const SheetTrigger = DialogPrimitive.Trigger
const SheetClose = DialogPrimitive.Close
const SheetPortal = DialogPrimitive.Portal

const SheetOverlay = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn('fixed inset-0 z-40 bg-black/30 dark:bg-black/60 animate-fade-in', className)}
    {...props}
  />
))
SheetOverlay.displayName = 'SheetOverlay'

const SheetContent = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    width?: 'sm' | 'md' | 'lg' | 'xl'
    /**
     * Commit the panel from the keyboard: Ctrl+S (the app-wide "save") and
     * Ctrl+Enter both run it from anywhere inside the sheet. The footer
     * buttons are the LAST stops in the DOM — after every field of the form —
     * so without this, saving a ten-field panel means ten more Tabs. The
     * sheet is not a <form> (consumers nest their own), so a bare Enter is
     * deliberately left alone: in a multi-field panel it would submit
     * half-finished work from whichever field happened to hold focus.
     */
    onSubmit?: () => void
  }
>(({ className, children, width = 'md', onSubmit, onKeyDown, ...props }, ref) => {
  const opener = React.useRef<HTMLElement | null>(null)
  // Below each cap the sheet is simply full-width — a phone has no room
  // for the underlying page to show through, so it reads as a full screen.
  const widthMap = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-2xl',
  } as const
  return (
    <SheetPortal>
      <SheetOverlay />
      <DialogPrimitive.Content
        ref={ref}
        /**
         * Radix focuses the first tabbable descendant, which for every sheet in
         * this app is the header's close X — so opening an edit panel put focus
         * on "discard" and every edit began by Tabbing off it. Prefer whatever
         * the body marks as its entry field; fall back to the first real form
         * control; only then let Radix do its thing.
         */
        /**
         * Restore focus to whatever opened this overlay — Radix's own close
         * handler focuses a <Sheet.Trigger> that state-driven sheets do not
         * have, so its preventDefault cancelled FocusScope's restore and left
         * focus on <body>. See dialog.tsx for the full reasoning.
         */
        onCloseAutoFocus={(e) => {
          e.preventDefault()
          const el = opener.current
          if (el?.isConnected) el.focus()
        }}
        onOpenAutoFocus={(e) => {
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
        onKeyDown={(e) => {
          onKeyDown?.(e)
          if (e.defaultPrevented || !onSubmit) return
          const isSave = (e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')
          const isCommit = (e.ctrlKey || e.metaKey) && e.key === 'Enter'
          if (isSave || isCommit) {
            e.preventDefault()
            // Stop the page-level Ctrl+S behind the sheet from also firing.
            e.stopPropagation()
            onSubmit()
          }
        }}
        className={cn(
          'fixed right-0 top-0 bottom-0 z-50 w-full bg-white border-l border-slate-200 shadow-xl flex flex-col animate-slide-in-right',
          widthMap[width],
          className,
        )}
        style={{ backgroundColor: 'var(--color-card-bg)', borderColor: 'var(--color-card-border)' }}
        {...props}
      >
        {/* See dialog.tsx — the sheet's own chords outrank the page's. */}
        <OverlayDepthProvider>{children}</OverlayDepthProvider>
      </DialogPrimitive.Content>
    </SheetPortal>
  )
})
SheetContent.displayName = 'SheetContent'

function SheetHeader({ children, className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('flex items-center justify-between px-4 sm:px-5 py-4 border-b flex-shrink-0', className)}
      style={{ borderColor: 'var(--color-card-border)' }}
      {...props}
    >
      <div className="flex-1 min-w-0">{children}</div>
      <SheetClose
        className="text-slate-400 hover:text-slate-900 transition-colors p-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
        aria-label="Close"
      >
        <X size={18} />
      </SheetClose>
    </div>
  )
}

const SheetTitle = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn('text-base font-semibold', className)}
    style={{ color: 'var(--color-text-primary)' }}
    {...props}
  />
))
SheetTitle.displayName = 'SheetTitle'

function SheetBody({ children, className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('flex-1 overflow-y-auto overscroll-contain px-4 sm:px-5 py-4', className)} {...props}>
      {children}
    </div>
  )
}

function SheetFooter({ children, className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('flex flex-wrap items-center justify-end gap-2 px-4 sm:px-5 py-3 border-t safe-bottom', className)}
      style={{ borderColor: 'var(--color-card-border)', backgroundColor: 'var(--color-grey-light)' }}
      {...props}
    >
      {children}
    </div>
  )
}

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetBody,
  SheetFooter,
}
