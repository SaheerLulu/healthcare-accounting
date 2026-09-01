import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  chordMatches,
  GLOBAL_ALLOW_LIST,
  shouldIgnoreEvent,
  type Chord,
} from '../lib/shortcuts'

export interface HotkeyHint {
  chord: string
  label: string
}

export interface HotkeyHandler {
  chord: Chord
  /** Whether to suppress the browser default when this chord fires. */
  preventDefault?: boolean
  handler: (e: KeyboardEvent) => void
  /**
   * Overlays enclosing this handler in the React tree. Stamped by
   * registerHandlers from OverlayDepthContext; callers never set it.
   */
  depth?: number
  /**
   * Fire even while a deeper overlay is open. Only for chords that must never
   * be unreachable — F1, which is how the user discovers everything else and
   * which has to be able to close the sheet it opened.
   */
  always?: boolean
}

/**
 * How many overlays enclose the component registering a chord.
 *
 * This is a property of the REACT TREE, and it has to be: the first version
 * read the open-dialog count from the DOM at registration time, which broke as
 * soon as a page gated a chord on something an overlay changes. Opening a
 * dialog flipped a `when`, which re-registered the PAGE's chords — and they
 * were then stamped depth 1, exactly the depth that means "I belong to the
 * overlay", so they fired straight through it. The tree answers the question
 * that was actually being asked: not "was a dialog open when this ran?" but
 * "is this handler inside the dialog?".
 *
 * DialogContent and SheetContent each bump it for their subtree.
 */
const OverlayDepthContext = createContext(0)

export function OverlayDepthProvider({ children }: { children: ReactNode }) {
  const parent = useContext(OverlayDepthContext)
  const value = useMemo(() => parent + 1, [parent])
  return <OverlayDepthContext.Provider value={value}>{children}</OverlayDepthContext.Provider>
}

export function useOverlayDepth(): number {
  return useContext(OverlayDepthContext)
}

/** Overlays actually open on screen right now, read from Radix's own markers. */
function openOverlayCount(): number {
  if (typeof document === 'undefined') return 0
  return document.querySelectorAll('[role="dialog"][data-state="open"]').length
}

interface HotkeyContextValue {
  registerHints: (hints: HotkeyHint[]) => () => void
  registerHandlers: (handlers: HotkeyHandler[], depth?: number) => () => void
  pageHints: HotkeyHint[]
  globalHints: HotkeyHint[]
}

const HotkeyContext = createContext<HotkeyContextValue | null>(null)

const GLOBAL_HINTS: HotkeyHint[] = [
  { chord: 'F4', label: 'Contra' },
  { chord: 'F5', label: 'Payment' },
  { chord: 'F6', label: 'Receipt' },
  { chord: 'F7', label: 'Journal' },
  { chord: 'F8', label: 'Sales' },
  { chord: 'F9', label: 'Purchase' },
  { chord: 'Ctrl+F8', label: 'Credit Note' },
  { chord: 'Ctrl+F9', label: 'Debit Note' },
  { chord: 'Ctrl+G', label: 'Gateway' },
  { chord: 'F11', label: 'Setup' },
]

export function HotkeyProvider({ children }: { children: ReactNode }) {
  const [pageHints, setPageHints] = useState<HotkeyHint[]>([])
  const handlersRef = useRef<HotkeyHandler[]>([])

  const registerHints = useCallback((hints: HotkeyHint[]) => {
    setPageHints(hints)
    return () => setPageHints([])
  }, [])

  const registerHandlers = useCallback((handlers: HotkeyHandler[], depth = 0) => {
    if ((import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV) {
      const existing = new Set(handlersRef.current.map((h) => h.chord.toLowerCase()))
      for (const h of handlers) {
        if (existing.has(h.chord.toLowerCase())) {
          // eslint-disable-next-line no-console
          console.warn(
            `[Hotkeys] Chord "${h.chord}" registered twice — only the most recently registered handler fires first.`
          )
        }
      }
    }
    const scoped: HotkeyHandler[] = handlers.map((h) => ({ ...h, depth }))
    handlersRef.current = [...handlersRef.current, ...scoped]
    return () => {
      handlersRef.current = handlersRef.current.filter((h) => !scoped.includes(h))
    }
  }, [])

  // Global keydown listener — runs all registered handlers for matching chords.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Use a fresh snapshot of handlers (reads ref so re-render isn't required).
      const candidates = handlersRef.current
      if (candidates.length === 0) return
      if (shouldIgnoreEvent(e, GLOBAL_ALLOW_LIST)) return
      // An open overlay owns the keyboard.
      //
      // Ctrl+S, Ctrl+Enter and the whole Alt+letter range are allow-listed so
      // they survive inside a text field — which is the point, you must be able
      // to save the voucher you are typing in. But that also meant they stayed
      // live BEHIND a modal: Ctrl+Enter on a "Discard this voucher?" dialog
      // discarded it and posted it, and Alt+D deleted a line the user could not
      // see. A handler fires only if it sits at least as deep in the overlay
      // tree as the number of overlays currently open — so the overlay's own
      // chords work and the page's underneath it do not.
      const open = openOverlayCount()
      // Iterate in reverse so most-recently-registered (typically page-scoped)
      // wins over earlier registrations (global navigation).
      for (let i = candidates.length - 1; i >= 0; i--) {
        const h = candidates[i]
        if (!h.always && (h.depth ?? 0) < open) continue
        if (chordMatches(h.chord, e)) {
          if (h.preventDefault !== false) e.preventDefault()
          h.handler(e)
          return
        }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const value = useMemo<HotkeyContextValue>(
    () => ({ registerHints, registerHandlers, pageHints, globalHints: GLOBAL_HINTS }),
    [registerHints, registerHandlers, pageHints]
  )

  return <HotkeyContext.Provider value={value}>{children}</HotkeyContext.Provider>
}

export function useHotkeyContext() {
  const ctx = useContext(HotkeyContext)
  if (!ctx) throw new Error('useHotkeyContext must be used inside <HotkeyProvider>')
  return ctx
}

/**
 * Register a list of keyboard handlers for the current page.
 * Re-registers when `handlers` array identity changes — wrap callbacks in
 * `useCallback` upstream and memoize the array with `useMemo`.
 */
export function useHotkeys(handlers: HotkeyHandler[]) {
  const { registerHandlers } = useHotkeyContext()
  const depth = useOverlayDepth()
  useEffect(() => {
    return registerHandlers(handlers, depth)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handlers, depth])
}

/** Register the page-scoped hints shown in the bottom hotkey bar. */
export function useHintRegister(hints: HotkeyHint[]) {
  const { registerHints } = useHotkeyContext()
  useEffect(() => {
    return registerHints(hints)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(hints)])
}
