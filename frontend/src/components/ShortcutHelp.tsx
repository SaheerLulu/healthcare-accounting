import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog'
import { useHotkeyContext, type HotkeyHint } from '../contexts/HotkeyContext'

/**
 * F1 — the catalogue of every key the app answers to.
 *
 * Half of it is generated rather than written down: the "On this page" column
 * reads the SAME `pageHints` the bottom HotkeyBar shows, so a screen that
 * registers a chord is documented by that act alone and can never drift from
 * a hand-maintained list. The conventions below it are the rules that hold
 * everywhere and so have nowhere else to live.
 *
 * Built on the Radix dialog, which supplies the focus trap, Escape-to-close
 * and focus restoration — a help overlay that stranded focus would be a
 * particularly poor joke in a keyboard-only app.
 */

interface Group {
  title: string
  hints: HotkeyHint[]
}

const CONVENTIONS: Group[] = [
  {
    title: 'Everywhere',
    hints: [
      { chord: 'F1', label: 'Show this help' },
      { chord: 'Ctrl+K', label: 'Go to any screen or voucher' },
      { chord: 'Ctrl+G', label: 'Back to the Gateway' },
      { chord: 'F11', label: 'Setup checklist' },
      { chord: 'F2', label: 'Jump to the search / filter box' },
      { chord: 'F3', label: 'Jump to the list' },
      { chord: 'Esc', label: 'Leave the field, then the screen' },
      { chord: 'Tab', label: 'Next control' },
      { chord: 'Shift+Tab', label: 'Previous control' },
    ],
  },
  {
    title: 'Lists and registers',
    hints: [
      { chord: '↑ ↓', label: 'Move between rows' },
      { chord: 'Enter', label: 'Open the highlighted row' },
      { chord: 'Home / End', label: 'First / last row' },
      { chord: 'PgUp / PgDn', label: 'Ten rows at a time' },
      { chord: 'Alt+N', label: 'New record' },
      { chord: 'Alt+X', label: 'Export the current view' },
    ],
  },
  {
    title: 'Voucher and form entry',
    hints: [
      { chord: 'Tab', label: 'Next cell — wraps to the next row' },
      { chord: 'Enter', label: 'Same column, next row' },
      { chord: 'Alt+A', label: 'Add a line' },
      { chord: 'Alt+D', label: 'Delete the focused line' },
      { chord: 'Alt+C', label: 'Create a ledger without leaving the voucher' },
      { chord: 'Ctrl+S', label: 'Save' },
      { chord: 'Ctrl+Enter', label: 'Save and post' },
    ],
  },
  {
    title: 'Vouchers from anywhere',
    hints: [
      { chord: 'F4', label: 'Contra' },
      { chord: 'F5', label: 'Payment' },
      { chord: 'F6', label: 'Receipt' },
      { chord: 'F7', label: 'Journal' },
      { chord: 'F8', label: 'Sales' },
      { chord: 'F9', label: 'Purchase' },
      { chord: 'Ctrl+F8', label: 'Credit Note' },
      { chord: 'Ctrl+F9', label: 'Debit Note' },
    ],
  },
]

export function ShortcutHelp({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { pageHints } = useHotkeyContext()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-3xl"
        description="Every keyboard shortcut this application responds to."
      >
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
        </DialogHeader>

        {pageHints.length > 0 && (
          <ShortcutGroup
            group={{ title: 'On this page', hints: pageHints }}
            highlight
          />
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-5 mt-4">
          {CONVENTIONS.map((g) => (
            <ShortcutGroup key={g.title} group={g} />
          ))}
        </div>

        <p
          className="text-xs mt-5 pt-4 border-t"
          style={{ color: 'var(--ink-3)', borderColor: 'var(--line)' }}
        >
          A shortcut listed under a section applies on every screen of that
          kind. Where a screen adds its own, they appear above and in the bar
          along the bottom of the window.
        </p>
      </DialogContent>
    </Dialog>
  )
}

function ShortcutGroup({ group, highlight }: { group: Group; highlight?: boolean }) {
  return (
    <div
      className={highlight ? 'rounded-lg p-3' : undefined}
      style={highlight ? { background: 'rgba(15,157,154,0.06)' } : undefined}
    >
      <h4
        className="mono text-[10px] uppercase font-semibold mb-2"
        style={{ color: highlight ? 'var(--brand)' : 'var(--ink-3)', letterSpacing: '0.1em' }}
      >
        {group.title}
      </h4>
      <div className="space-y-1.5">
        {group.hints.map((h, i) => (
          <div key={`${h.chord}-${i}`} className="flex items-baseline justify-between gap-4">
            <span className="text-sm" style={{ color: 'var(--ink-2)' }}>
              {h.label}
            </span>
            <kbd
              className="mono text-[10px] px-1.5 py-0.5 rounded whitespace-nowrap flex-shrink-0"
              style={{
                background: 'var(--surface-1)',
                border: '1px solid var(--line)',
                color: 'var(--brand)',
                fontWeight: 600,
              }}
            >
              {h.chord}
            </kbd>
          </div>
        ))}
      </div>
    </div>
  )
}
