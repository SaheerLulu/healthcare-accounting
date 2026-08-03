import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from '../../lib/utils'

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
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { width?: 'sm' | 'md' | 'lg' | 'xl' }
>(({ className, children, width = 'md', ...props }, ref) => {
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
        className={cn(
          'fixed right-0 top-0 bottom-0 z-50 w-full bg-white border-l border-slate-200 shadow-xl flex flex-col animate-slide-in-right',
          widthMap[width],
          className,
        )}
        style={{ backgroundColor: 'var(--color-card-bg)', borderColor: 'var(--color-card-border)' }}
        {...props}
      >
        {children}
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
      <SheetClose className="text-slate-400 hover:text-slate-900 transition-colors p-1">
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
