import * as Dialog from '@radix-ui/react-dialog'
import { AlertTriangle, X } from 'lucide-react'
import { useRef, type ReactNode } from 'react'
import { OverlayDepthProvider } from '../../contexts/HotkeyContext'

type Tone = 'default' | 'danger'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  tone?: Tone
  onConfirm: () => void | Promise<void>
  loading?: boolean
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'default',
  onConfirm,
  loading = false,
}: Props) {
  const confirmBg = tone === 'danger' ? 'var(--danger)' : 'var(--brand)'
  const iconBg = tone === 'danger' ? 'rgba(192,57,43,0.12)' : 'rgba(15,157,154,0.10)'
  const iconFg = tone === 'danger' ? 'var(--danger)' : 'var(--brand)'
  const confirmRef = useRef<HTMLButtonElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const opener = useRef<HTMLElement | null>(null)

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          className="fixed inset-0 z-50 animate-fadeIn"
          style={{ background: 'rgba(12,30,37,0.45)' }}
        />
        <Dialog.Content
          /**
           * Radix otherwise focuses the first tabbable child, which here is the
           * header's close X — so Enter on a freshly opened confirm CANCELLED
           * it. For a keyboard-only user that is the difference between "the
           * dialog did nothing" and "the dialog did the thing", and it made
           * every confirmation a two-Tab detour.
           *
           * A destructive confirm deliberately lands on Cancel instead: the
           * safe default should be the one a reflexive Enter picks.
           */
          /**
           * Restore focus to whatever opened the confirm. Radix focuses a
           * trigger this dialog does not have, so both Cancel and Confirm used
           * to end with focus on <body> — throwing the user out of the row, or
           * out of the form they were told to keep editing. See dialog.tsx.
           */
          onCloseAutoFocus={(e) => {
            e.preventDefault()
            const el = opener.current
            if (el?.isConnected) el.focus()
          }}
          onOpenAutoFocus={(e) => {
            opener.current = document.activeElement as HTMLElement | null
            e.preventDefault()
            const target = tone === 'danger' ? cancelRef.current : confirmRef.current
            target?.focus()
          }}
          onKeyDown={(e) => {
            // Ctrl/Cmd+Enter confirms from anywhere in the dialog, including
            // from Cancel — the explicit "yes, do it" that needs no aiming.
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !loading) {
              e.preventDefault()
              onConfirm()
            }
          }}
          className="fixed left-1/2 top-1/2 z-50 w-[92vw] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl p-6 animate-slideUp"
          style={{
            background: 'var(--surface-0)',
            border: '1px solid var(--line)',
            boxShadow: '0 12px 40px rgba(0,0,0,0.18), 0 4px 12px rgba(0,0,0,0.08)',
          }}
        >
          <OverlayDepthProvider>
          <div className="flex items-start gap-4">
            <div
              className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ background: iconBg }}
            >
              <AlertTriangle className="w-5 h-5" style={{ color: iconFg }} />
            </div>
            <div className="flex-1 min-w-0">
              <Dialog.Title
                className="text-base font-semibold"
                style={{ color: 'var(--ink)' }}
              >
                {title}
              </Dialog.Title>
              {description && (
                <Dialog.Description
                  className="text-sm mt-1.5"
                  style={{ color: 'var(--ink-2)' }}
                >
                  {description}
                </Dialog.Description>
              )}
            </div>
            <Dialog.Close
              className="p-1 rounded hover:bg-[var(--color-hover-bg)] flex-shrink-0"
              aria-label="Close"
            >
              <X className="w-4 h-4" style={{ color: 'var(--ink-3)' }} />
            </Dialog.Close>
          </div>
          <div className="flex justify-end gap-2 mt-6">
            <Dialog.Close
              ref={cancelRef}
              className="h-9 px-4 rounded-md text-sm font-medium"
              style={{
                border: '1px solid var(--line)',
                background: 'var(--surface-0)',
                color: 'var(--ink)',
              }}
              disabled={loading}
            >
              {cancelLabel}
            </Dialog.Close>
            <button
              ref={confirmRef}
              type="button"
              onClick={() => onConfirm()}
              // aria-disabled rather than `disabled` while working: disabling
              // the button the user just pressed removes it from the document
              // and drops focus to <body>, stranding a keyboard user mid-flight.
              // Re-entry is guarded in the handler instead.
              aria-disabled={loading}
              aria-busy={loading}
              onClickCapture={(e) => { if (loading) e.stopPropagation() }}
              className="h-9 px-4 rounded-md text-sm font-semibold text-white hover:opacity-90"
              style={{ background: confirmBg, opacity: loading ? 0.6 : 1 }}
            >
              {loading ? 'Working…' : confirmLabel}
            </button>
          </div>
          </OverlayDepthProvider>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
