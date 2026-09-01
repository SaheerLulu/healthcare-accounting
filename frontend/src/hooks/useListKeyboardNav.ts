import { useCallback, useEffect, useRef, useState } from 'react'
import { isFormField } from './useEscapeBack'

/**
 * Arrow-key navigation over a list or table whose rows open something.
 *
 * The problem this solves is the commonest keyboard dead-end in the app: a
 * `<Tr onClick={...}>` is not focusable, is not in the tab order, and does not
 * respond to Enter — so a register with 200 rows is completely unreachable
 * without a pointer. Giving every row `tabIndex={0}` instead would be worse:
 * the user would Tab through 200 stops to reach the pagination below.
 *
 * This is the standard roving-tabindex fix. Exactly ONE row is in the tab
 * order at a time (the active one); Up/Down move that focus within the list,
 * and Tab jumps clean out of it to the next control on the page.
 *
 *   ↑ / ↓        previous / next row
 *   Home / End   first / last row
 *   PageUp/Down  ten rows at a time
 *   Enter        activate the row (the same thing a click does)
 *   Space        activate, without scrolling the page
 *
 * Usage:
 *   const list = useListKeyboardNav({ count: rows.length, onActivate: i => open(rows[i]) })
 *   <Tbody {...list.containerProps}>
 *     {rows.map((r, i) => <Tr key={r.id} {...list.rowProps(i)}>…</Tr>)}
 *
 * `rowProps` supplies role/tabIndex/onKeyDown/onFocus and a `data-active`
 * attribute for styling the current row. Callers keep their own onClick.
 */
export interface UseListKeyboardNavOptions {
  /** How many rows are currently rendered. */
  count: number
  /** Invoked with the row index on Enter/Space. Omit for a non-activatable list. */
  onActivate?: (index: number) => void
  /**
   * Rows to move per PageUp/PageDown. Default 10.
   */
  pageSize?: number
  /**
   * When true (default) the active index resets to 0 as `count` changes —
   * a re-filtered list should start at the top, not hold a stale offset.
   */
  resetOnCountChange?: boolean
}

export function useListKeyboardNav({
  count,
  onActivate,
  pageSize = 10,
  resetOnCountChange = true,
}: UseListKeyboardNavOptions) {
  const [active, setActive] = useState(0)
  const containerRef = useRef<HTMLElement | null>(null)
  // Only move focus in response to a KEY press. Without this the list would
  // grab focus from wherever the user was the moment it re-rendered.
  const shouldFocusRef = useRef(false)

  useEffect(() => {
    if (!resetOnCountChange) return
    setActive((i) => (i < count ? i : 0))
  }, [count, resetOnCountChange])

  const focusRow = useCallback((index: number) => {
    const root = containerRef.current
    if (!root) return
    const row = root.querySelector<HTMLElement>(`[data-kbd-row="${index}"]`)
    row?.focus()
    // `block: 'nearest'` so paging down does not yank the header off-screen.
    row?.scrollIntoView({ block: 'nearest' })
  }, [])

  useEffect(() => {
    if (!shouldFocusRef.current) return
    shouldFocusRef.current = false
    focusRow(active)
  }, [active, focusRow])

  const move = useCallback(
    (next: number) => {
      if (count === 0) return
      shouldFocusRef.current = true
      setActive(Math.max(0, Math.min(count - 1, next)))
    },
    [count],
  )

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent, index: number) => {
      // A row can hold its own input (an inline amount, a checkbox). Arrow keys
      // belong to that field while it has focus.
      if (isFormField(e.target as HTMLElement)) return
      // Nor does the row own keys aimed at a control INSIDE it. A row that
      // carries its own "Mark read" button or "View" link would otherwise
      // activate twice from one Enter — once for the button, once for the row
      // — and the row's action is usually the more consequential of the two.
      if (e.target !== e.currentTarget) {
        const el = e.target as HTMLElement | null
        if (el?.closest('button, a, [role="button"], [role="link"], summary')) return
      }
      // A chord is never a row action. Ctrl+Enter in particular is "save" or
      // "confirm" on the surrounding screen, and letting it fall through to
      // the Enter branch made one keystroke both pick a row AND submit the
      // form behind it.
      if (e.ctrlKey || e.metaKey || e.altKey) return

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          move(index + 1)
          break
        case 'ArrowUp':
          e.preventDefault()
          move(index - 1)
          break
        case 'Home':
          e.preventDefault()
          move(0)
          break
        case 'End':
          e.preventDefault()
          move(count - 1)
          break
        case 'PageDown':
          e.preventDefault()
          move(index + pageSize)
          break
        case 'PageUp':
          e.preventDefault()
          move(index - pageSize)
          break
        case 'Enter':
        case ' ':
          if (!onActivate || e.shiftKey) return
          e.preventDefault()
          onActivate(index)
          break
        default:
      }
    },
    [count, move, onActivate, pageSize],
  )

  const containerProps = {
    ref: (el: HTMLElement | null) => {
      containerRef.current = el
    },
  }

  const rowProps = useCallback(
    (index: number) => ({
      'data-kbd-row': index,
      'data-active': index === active ? '' : undefined,
      // Roving tabindex: one stop for the whole list.
      tabIndex: index === active ? 0 : -1,
      role: onActivate ? ('button' as const) : undefined,
      onKeyDown: (e: React.KeyboardEvent) => onKeyDown(e, index),
      // Clicking a row makes it the active one, so a subsequent ArrowDown
      // continues from where the user actually is.
      onFocus: () => setActive(index),
    }),
    [active, onActivate, onKeyDown],
  )

  /** Move focus into the list from a page-level chord (e.g. F2 then ↓). */
  const focusList = useCallback(() => {
    shouldFocusRef.current = true
    setActive((i) => (count > 0 ? Math.min(i, count - 1) : 0))
    focusRow(Math.min(active, Math.max(0, count - 1)))
  }, [active, count, focusRow])

  return { active, setActive, containerProps, rowProps, focusList }
}
