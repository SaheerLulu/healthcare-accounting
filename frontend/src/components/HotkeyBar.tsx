import { useHotkeyContext, type HotkeyHint } from '../contexts/HotkeyContext'

/**
 * Tally-style fixed hotkey hint bar at the bottom of the viewport.
 * Shows page-scoped hints when registered, otherwise the global default.
 *
 * Hidden below `md`: it advertises F-keys and Ctrl chords, which a touch
 * device has no way to press, so on phones it would cost a row of screen
 * to say nothing. The shortcuts themselves stay bound.
 */
export function HotkeyBar({ onHelp }: { onHelp?: () => void }) {
  const { pageHints, globalHints } = useHotkeyContext()
  const hints = pageHints.length > 0 ? pageHints : globalHints

  return (
    <div
      className="hidden md:flex fixed bottom-0 left-0 right-0 z-30 border-t items-center gap-1.5 px-4 h-9 overflow-x-auto"
      style={{
        background: 'var(--surface-0)',
        borderColor: 'var(--line)',
        boxShadow: '0 -2px 8px rgba(0,0,0,0.04)',
      }}
    >
      {hints.map((h, i) => (
        <HintChip key={`${h.chord}-${i}`} hint={h} />
      ))}
      <div className="flex-1" />
      {/* The bar can only show a handful of chords; F1 is how the user reaches
          the rest. A button rather than a bare hint so it is reachable by Tab
          too — this bar is the app's only always-visible keyboard signpost. */}
      <button
        type="button"
        onClick={onHelp}
        className="inline-flex items-center gap-1 px-2 h-6 rounded text-xs whitespace-nowrap flex-shrink-0"
        style={{ color: 'var(--ink-2)' }}
        title="All keyboard shortcuts"
      >
        <kbd
          className="mono text-[10px] px-1 rounded"
          style={{
            background: 'var(--surface-1)',
            border: '1px solid var(--line)',
            color: 'var(--brand)',
            fontWeight: 600,
          }}
        >
          F1
        </kbd>
        <span className="font-medium">All keys</span>
      </button>
    </div>
  )
}

function HintChip({ hint }: { hint: HotkeyHint }) {
  return (
    <span
      className="inline-flex items-center gap-1 px-2 h-6 rounded text-xs whitespace-nowrap"
      style={{
        background: 'rgba(15,157,154,0.08)',
        color: 'var(--ink-2)',
        border: '1px solid rgba(15,157,154,0.18)',
      }}
    >
      <kbd
        className="mono text-[10px] px-1 rounded"
        style={{
          background: 'var(--surface-1)',
          border: '1px solid var(--line)',
          color: 'var(--brand)',
          fontWeight: 600,
        }}
      >
        {hint.chord}
      </kbd>
      <span style={{ color: 'var(--ink)' }} className="font-medium">
        {hint.label}
      </span>
    </span>
  )
}
