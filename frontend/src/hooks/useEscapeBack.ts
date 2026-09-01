import { useEffect, useRef } from 'react'

/**
 * Escape leaves the current screen — the keyboard equivalent of the in-page
 * "Back" button, and the single most-used key in a Tally-style workflow.
 *
 * Deliberately NOT routed through HotkeyContext. `Escape` sits in
 * GLOBAL_ALLOW_LIST, so `shouldIgnoreEvent` waves it through *everywhere* —
 * including inside an open Radix dialog, where a page-level "go back" would
 * fire behind the modal the user was actually trying to close. This hook owns
 * the three cases that allow-list cannot distinguish:
 *
 *   1. Focus is in a form field  → blur it. There, Escape means "leave the
 *      field", not "leave the page"; a second press then goes back. This is
 *      what lets a user escape a half-typed filter without losing the screen.
 *   2. An overlay is open        → do nothing. Radix marks the open dialog,
 *      sheet or popover with `[role="dialog"]` / `[data-state="open"]` and
 *      closes it on Escape itself. Two handlers would close both at once.
 *   3. Otherwise                 → go back.
 *
 * Pass `active: false` while the screen is not in its detail state, so a list
 * view does not steal Escape from the page underneath it.
 */
export function useEscapeBack(active: boolean, onBack: () => void) {
  // Held in a ref so a caller that rebuilds `onBack` every render does not
  // re-register the listener on every keystroke.
  const onBackRef = useRef(onBack)
  onBackRef.current = onBack

  useEffect(() => {
    if (!active) return
    function handler(e: KeyboardEvent) {
      if (e.key !== 'Escape' || e.repeat) return

      const el = e.target as HTMLElement | null
      if (el && isFormField(el)) {
        el.blur()
        return
      }
      // An open Radix overlay handles its own Escape.
      if (document.querySelector('[role="dialog"][data-state="open"]')) return

      e.preventDefault()
      onBackRef.current()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [active])
}

export function isFormField(el: HTMLElement | null): boolean {
  if (!el) return false
  const tag = el.tagName
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    el.isContentEditable
  )
}
