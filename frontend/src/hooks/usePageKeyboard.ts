import { useEffect, useMemo, useRef, type RefObject } from 'react'
import {
  useHintRegister,
  useHotkeyContext,
  useOverlayDepth,
  type HotkeyHint,
} from '../contexts/HotkeyContext'
import type { Chord } from '../lib/shortcuts'
import { useEscapeBack } from './useEscapeBack'

/**
 * One call per screen to declare its whole keyboard contract.
 *
 * The lower-level `useHotkeys` / `useHintRegister` pair works, but using it
 * correctly needs a `useMemo` around the handler array (its effect keys on
 * array identity) and a second, parallel list of hints. Across ~90 screens
 * that is a lot of boilerplate, and — worse — two lists that drift: a chord
 * gets added to the handlers and never reaches the hint bar, so the shortcut
 * exists but nobody can discover it. Here the hint IS the handler.
 *
 *   usePageKeyboard({
 *     actions: [
 *       { chord: 'Alt+N', label: 'New bill', run: () => nav('/bills/new') },
 *       { chord: 'Ctrl+S', label: 'Save', run: save, when: dirty },
 *     ],
 *     searchRef,          // F2 focuses it
 *     onFocusList,        // F3 moves into the rows
 *     onBack,             // Esc leaves the screen
 *   })
 *
 * Pass `actions` inline — the array identity is deliberately NOT part of the
 * dependency key, so a fresh array on every render does not re-register. What
 * IS tracked is the chord/label/enabled signature, and `run` is read through a
 * ref, so a handler always sees current state without re-binding.
 */
export interface PageAction {
  chord: Chord
  /** Shown in the bottom hint bar and in the F1 catalogue. */
  label: string
  run: () => void
  /** Register only while true. Defaults to true. */
  when?: boolean
  /** Bind the chord but keep it out of the hint bar (rarely wanted). */
  hidden?: boolean
  /**
   * The mirror of `hidden`: advertise the chord but bind nothing, because
   * something else already handles it.
   *
   * The case this exists for is a tab strip. TabsTrigger registers its own
   * chord — that is what routes the switch through the strip's
   * `onValueChange`, so a screen holding unsaved edits can veto it — and it
   * paints the keycap on the pill. But `registerHints` replaces a whole
   * screen's hint list, so a shared component must never publish into it, and
   * the keycap itself is hidden below `lg`. Declaring the chord here with
   * `hintOnly` gets it into the bottom bar and the F1 catalogue without a
   * second handler that would shadow the first and bypass the veto.
   */
  hintOnly?: boolean
  /** Let the browser keep its default for this chord. */
  allowDefault?: boolean
}

export interface UsePageKeyboardOptions {
  actions?: PageAction[]
  /** F2 focuses (and selects) this input — the screen's search or filter box. */
  searchRef?: RefObject<HTMLInputElement | null>
  /** F3 moves focus into the screen's list/table. */
  onFocusList?: () => void
  /** Escape leaves the screen. See useEscapeBack for the exact semantics. */
  onBack?: () => void
  /** Gate Escape — pass false while a child owns it. Defaults to true. */
  backActive?: boolean
}

export function usePageKeyboard({
  actions,
  searchRef,
  onFocusList,
  onBack,
  backActive = true,
}: UsePageKeyboardOptions) {
  const { registerHandlers } = useHotkeyContext()
  const overlayDepth = useOverlayDepth()

  // Everything callable is read through this ref at fire time, so a stale
  // closure can never be invoked and no callback identity forces a re-bind.
  const latest = useRef({ actions, searchRef, onFocusList })
  latest.current = { actions, searchRef, onFocusList }

  // Every declared chord is REGISTERED, whether or not it is currently
  // actionable — a disabled one is swallowed rather than dropped. Dropping it
  // handed the key back to the browser: Ctrl+S on a voucher that was mid-save
  // opened the browser's Save Page dialog over the top of it. A chord the page
  // has claimed stays claimed; `when` decides whether it DOES anything.
  const declared = useMemo(
    () => actions ?? [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [signature(actions)],
  )
  const enabled = useMemo(
    () => declared.filter((a) => a.when !== false),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [signature(actions)],
  )

  // The chord set is what the listener needs; identity changes only when a
  // chord is added, removed, or toggled by `when`.
  // Keyed on the DECLARED set, so toggling `when` never re-registers. That
  // matters beyond efficiency: registration stamps the overlay depth, and a
  // `when` that flips because a dialog opened would otherwise re-stamp the
  // page's chords as if they belonged to that dialog.
  const chordKey = declared.filter((a) => !a.hintOnly).map((a) => a.chord).join('|')
  const wantsSearch = !!searchRef
  const wantsList = !!onFocusList

  useEffect(() => {
    const handlers = declared.filter((a) => !a.hintOnly).map((a) => ({
      chord: a.chord,
      preventDefault: !a.allowDefault,
      handler: () => {
        // Re-read: `declared` is a snapshot, `latest` is now. A chord whose
        // `when` is false finds nothing here and does nothing — but it was
        // still matched, so preventDefault already fired and the browser
        // never sees it.
        const live = (latest.current.actions ?? []).find(
          (x) => x.chord === a.chord && x.when !== false,
        )
        live?.run()
      },
    }))

    if (wantsSearch) {
      handlers.push({
        chord: 'F2',
        preventDefault: true,
        handler: () => {
          const el = latest.current.searchRef?.current
          el?.focus()
          // Select so F2 restarts a search rather than appending to the last one.
          el?.select?.()
        },
      })
    }
    if (wantsList) {
      handlers.push({
        chord: 'F3',
        preventDefault: true,
        handler: () => latest.current.onFocusList?.(),
      })
    }

    if (handlers.length === 0) return
    return registerHandlers(handlers, overlayDepth)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chordKey, wantsSearch, wantsList, registerHandlers, overlayDepth])

  const hints = useMemo<HotkeyHint[]>(() => {
    const out = enabled
      .filter((a) => !a.hidden)
      .map((a) => ({ chord: a.chord, label: a.label }))
    // Advertised last: they are the same on every screen, so they belong after
    // whatever makes THIS screen different.
    if (wantsSearch) out.push({ chord: 'F2', label: 'Search' })
    if (wantsList) out.push({ chord: 'F3', label: 'List' })
    if (onBack && backActive) out.push({ chord: 'Esc', label: 'Back' })
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chordKey, wantsSearch, wantsList, !!onBack, backActive, signature(enabled)])

  useHintRegister(hints)
  useEscapeBack(!!onBack && backActive, onBack ?? noop)
}

function noop() {}

/** Chord + label + enabled state — what a re-registration actually depends on. */
function signature(actions?: PageAction[]): string {
  return (actions ?? [])
    .map((a) => `${a.chord}:${a.label}:${a.when !== false ? 1 : 0}:${a.hidden ? 1 : 0}:${a.hintOnly ? 1 : 0}`)
    .join('|')
}
