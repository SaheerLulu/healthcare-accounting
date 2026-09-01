import { useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Loader2, X } from 'lucide-react'
import { toast } from 'sonner'
import { createAccount, type Account } from '../../lib/api'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  parents: Account[]
  /** Called with the newly-created account; the parent should prepend it to its
   *  local accounts list and auto-select it for the triggering line. */
  onCreated: (account: Account) => void
}

const TYPES = [
  { value: 'ASSET', label: 'Asset' },
  { value: 'LIABILITY', label: 'Liability' },
  { value: 'EQUITY', label: 'Equity' },
  { value: 'REVENUE', label: 'Revenue' },
  { value: 'EXPENSE', label: 'Expense' },
]

export function CreateLedgerModal({ open, onOpenChange, parents, onCreated }: Props) {
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [type, setType] = useState('EXPENSE')
  const [parent, setParent] = useState<number | ''>('')
  const [saving, setSaving] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)
  const codeRef = useRef<HTMLInputElement>(null)
  const formRef = useRef<HTMLFormElement>(null)

  function reset() {
    setCode('')
    setName('')
    setType('EXPENSE')
    setParent('')
  }

  function close() {
    onOpenChange(false)
    reset()
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    void create()
  }

  async function create() {
    if (!name.trim()) {
      toast.error('Account name is required')
      return
    }
    setSaving(true)
    try {
      const acc = await createAccount({
        account_code: code.trim() || `NEW-${Date.now().toString().slice(-5)}`,
        account_name: name.trim(),
        account_type: type,
        parent: parent === '' ? null : Number(parent),
        is_active: true,
      })
      toast.success(`Created ${acc.account_name}`)
      onCreated(acc)
      reset()
      onOpenChange(false)
    } catch (err) {
      const e = err as { response?: { data?: Record<string, unknown> } }
      const data = e.response?.data
      const msg = data
        ? Object.entries(data)
            .map(([k, v]) =>
              `${k}: ${Array.isArray(v) ? v.join(', ') : String(v)}`
            )
            .join(' • ')
        : 'Failed to create ledger'
      toast.error(msg)
    } finally {
      setSaving(false)
    }
  }

  /**
   * The voucher behind this modal binds Ctrl+A (save & post), Ctrl+H and Alt+C
   * on the document, and every one of those sits in GLOBAL_ALLOW_LIST — so
   * untouched they fire straight THROUGH a half-filled create form: Ctrl+A
   * posted the voucher underneath. Chords stop at the modal now. The two that
   * mean something here are handled; the rest are swallowed without a
   * preventDefault, so Ctrl+A still selects the text in the focused field — it
   * just no longer posts anything.
   *
   * Escape is deliberately NOT here. Radix dismisses from a capture-phase
   * document listener and calls preventDefault() before it does
   * (react-dismissable-layer), so this bubble-phase handler can never see that
   * key — an Escape branch here would be dead code. It lives on Content's
   * `onEscapeKeyDown` below, which is the one hook that runs first.
   */
  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.defaultPrevented) return
    const isCommit =
      (e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S' || e.key === 'Enter')
    if (isCommit) {
      e.preventDefault()
      e.stopPropagation()
      if (!saving) formRef.current?.requestSubmit()
      return
    }
    if (e.ctrlKey || e.metaKey || e.altKey) e.stopPropagation()
  }

  // Limit parent dropdown to non-leaf parents matching the selected type.
  const eligibleParents = parents.filter(
    (a) => a.account_type === type && (a.children == null || a.is_leaf === false)
  )

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset() }}>
      <Dialog.Portal>
        <Dialog.Overlay
          className="fixed inset-0 z-50 animate-fadeIn"
          style={{ background: 'rgba(12,30,37,0.45)' }}
        />
        <Dialog.Content
          onKeyDown={handleKeyDown}
          /**
           * Radix's Escape is the only Escape this modal gets: its listener is
           * on the document in the capture phase and it preventDefaults before
           * dismissing, so nothing in the React tree — not this Content, not
           * `Input`'s own handler — is ever reached. Both halves of the app's
           * Escape contract therefore have to be re-stated here:
           *
           *  · A field with something in it clears first, one press per field,
           *    exactly as `Input` does everywhere outside a Radix layer. That
           *    is what stops a stray Escape from throwing away a half-typed
           *    ledger name along with the form around it.
           *  · Mid-create, Escape does nothing at all — the request is already
           *    in flight and `onCreated` is about to select the new ledger.
           *
           * Anything else falls through to Radix, which closes the modal and
           * resets it through Root's onOpenChange. The page's discard/back
           * handler behind us stays out of it: Radix stops the default, and
           * shortcuts.ts / useEscapeBack both skip an open [role="dialog"].
           *
           * The two cases that keep the modal open also stop the event dead —
           * this listener is Radix's, on the document in the capture phase, so
           * without that the same press still reaches the page's useEscapeBack
           * underneath, which blurs any focused field. Clearing a field and
           * being thrown out of it by one keystroke is not the contract.
           */
          onEscapeKeyDown={(e) => {
            if (saving) {
              e.preventDefault()
              e.stopPropagation()
              return
            }
            const el = document.activeElement
            if (el === nameRef.current && name !== '') {
              e.preventDefault()
              e.stopPropagation()
              setName('')
              return
            }
            if (el === codeRef.current && code !== '') {
              e.preventDefault()
              e.stopPropagation()
              setCode('')
            }
          }}
          /* Radix lands on the first tabbable child, which here is the header's
             close X. The entry field is what the caret should be in. */
          onOpenAutoFocus={(e) => {
            e.preventDefault()
            nameRef.current?.focus()
          }}
          className="fixed left-1/2 top-1/2 z-50 w-[92vw] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl p-4 sm:p-6 animate-slideUp max-h-[85dvh] overflow-y-auto overscroll-contain"
          style={{
            background: 'var(--surface-0)',
            border: '1px solid var(--line)',
            boxShadow: '0 12px 40px rgba(0,0,0,0.18)',
          }}
        >
          <div className="flex items-start justify-between mb-4">
            <div className="min-w-0">
              <Dialog.Title className="text-base font-semibold" style={{ color: 'var(--ink)' }}>
                Create Ledger
              </Dialog.Title>
              <Dialog.Description className="text-xs mt-0.5" style={{ color: 'var(--ink-2)' }}>
                Add a new chart-of-accounts entry without leaving this voucher
              </Dialog.Description>
            </div>
            <Dialog.Close
              className="shrink-0 p-1 rounded hover:bg-[var(--color-hover-bg)]"
              aria-label="Close"
              aria-keyshortcuts="Escape"
              title="Close (Esc)"
            >
              <X className="w-4 h-4" style={{ color: 'var(--ink-3)' }} />
            </Dialog.Close>
          </div>

          <form ref={formRef} onSubmit={submit} className="space-y-3">
            <Field label="Name" required>
              <Input
                ref={nameRef}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Stationery"
                data-autofocus
                autoFocus
              />
            </Field>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Code" hint="Optional — auto-generated if blank">
                <Input
                  ref={codeRef}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="e.g. 5450"
                  className="font-mono"
                />
              </Field>
              <Field label="Type" required>
                <select
                  value={type}
                  onChange={(e) => setType(e.target.value)}
                  className="w-full h-9 px-3 text-sm border rounded-md outline-none focus:shadow-[0_0_0_3px_rgba(15,157,154,0.18)]"
                  style={{ backgroundColor: 'var(--surface-0)', borderColor: 'var(--line)', color: 'var(--ink)' }}
                >
                  {TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label="Group / Parent" hint="Optional">
              <select
                value={parent}
                onChange={(e) => setParent(e.target.value ? Number(e.target.value) : '')}
                className="w-full h-9 px-3 text-sm border rounded-md outline-none focus:shadow-[0_0_0_3px_rgba(15,157,154,0.18)]"
                style={{ backgroundColor: 'var(--surface-0)', borderColor: 'var(--line)', color: 'var(--ink)' }}
              >
                <option value="">— Top-level —</option>
                {eligibleParents.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.account_code} — {p.account_name}
                  </option>
                ))}
              </select>
            </Field>

            <div
              className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t mt-4"
              style={{ borderColor: 'var(--line)' }}
            >
              {/* The modal's own keys, said out loud — nothing here can reach
                  the page hint bar without wiping the voucher's hints. */}
              <span className="text-[11px]" style={{ color: 'var(--ink-3)' }}>
                <kbd className="mono">Enter</kbd> or <kbd className="mono">Ctrl+S</kbd> create ·{' '}
                <kbd className="mono">Esc</kbd> cancel
              </span>
              <div className="flex items-center justify-end gap-2 ml-auto">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={close}
                  disabled={saving}
                  aria-keyshortcuts="Escape"
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={saving} aria-keyshortcuts="Control+S">
                  {saving && <Loader2 className="animate-spin" size={14} />}
                  Create
                </Button>
              </div>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function Field({ label, required, hint, children }: {
  label: string
  required?: boolean
  hint?: string
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="block text-xs font-medium mb-1" style={{ color: 'var(--ink-2)' }}>
        {label} {required && <span style={{ color: 'var(--danger)' }}>*</span>}
      </span>
      {children}
      {hint && <span className="block text-[11px] mt-1" style={{ color: 'var(--ink-3)' }}>{hint}</span>}
    </label>
  )
}
