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
}

interface HotkeyContextValue {
  registerHints: (hints: HotkeyHint[]) => () => void
  registerHandlers: (handlers: HotkeyHandler[]) => () => void
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
]

export function HotkeyProvider({ children }: { children: ReactNode }) {
  const [pageHints, setPageHints] = useState<HotkeyHint[]>([])
  const handlersRef = useRef<HotkeyHandler[]>([])

  const registerHints = useCallback((hints: HotkeyHint[]) => {
    setPageHints(hints)
    return () => setPageHints([])
  }, [])

  const registerHandlers = useCallback((handlers: HotkeyHandler[]) => {
    handlersRef.current = [...handlersRef.current, ...handlers]
    return () => {
      handlersRef.current = handlersRef.current.filter((h) => !handlers.includes(h))
    }
  }, [])

  // Global keydown listener — runs all registered handlers for matching chords.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Use a fresh snapshot of handlers (reads ref so re-render isn't required).
      const candidates = handlersRef.current
      if (candidates.length === 0) return
      if (shouldIgnoreEvent(e, GLOBAL_ALLOW_LIST)) return
      for (const h of candidates) {
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
  useEffect(() => {
    return registerHandlers(handlers)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handlers])
}

/** Register the page-scoped hints shown in the bottom hotkey bar. */
export function useHintRegister(hints: HotkeyHint[]) {
  const { registerHints } = useHotkeyContext()
  useEffect(() => {
    return registerHints(hints)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(hints)])
}
