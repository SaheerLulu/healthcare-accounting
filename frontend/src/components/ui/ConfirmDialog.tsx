import * as Dialog from '@radix-ui/react-dialog'
import { AlertTriangle, X } from 'lucide-react'
import type { ReactNode } from 'react'

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

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          className="fixed inset-0 z-50 animate-fadeIn"
          style={{ background: 'rgba(12,30,37,0.45)' }}
        />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 w-[92vw] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl p-6 animate-slideUp"
          style={{
            background: 'var(--surface-0)',
            border: '1px solid var(--line)',
            boxShadow: '0 12px 40px rgba(0,0,0,0.18), 0 4px 12px rgba(0,0,0,0.08)',
          }}
        >
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
              type="button"
              onClick={() => onConfirm()}
              disabled={loading}
              className="h-9 px-4 rounded-md text-sm font-semibold text-white disabled:opacity-60 hover:opacity-90"
              style={{ background: confirmBg }}
            >
              {loading ? 'Working…' : confirmLabel}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
