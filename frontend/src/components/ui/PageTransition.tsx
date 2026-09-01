import { useEffect, useRef, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'

interface Props {
  children: ReactNode
}

export function PageTransition({ children }: Props) {
  const loc = useLocation()
  const ref = useRef<HTMLDivElement>(null)

  /**
   * Move focus into the new screen on every navigation.
   *
   * Without this, a keyboard-only user who picks a page from the nav — or from
   * Ctrl+K, or an F-key — is left with focus still on the nav item (or on
   * nothing at all, once the palette that had it unmounts). Their next Tab
   * then walks the whole header again before reaching the page they asked for,
   * and a screen reader announces nothing.
   *
   * Preference order:
   *   1. anything marked `data-autofocus` — an editor's first entry field, so
   *      a voucher screen is ready to type into the instant it opens;
   *   2. otherwise the page container itself, which is what a screen reader
   *      reads from and what makes the first Tab land on the page's own first
   *      control.
   *
   * The container takes tabIndex={-1}: programmatically focusable, but never a
   * Tab stop of its own. Focus is NOT scrolled into view — the browser has
   * already put the new route at the top, and scrolling to a deep autofocus
   * target would jump past the heading the user needs to read.
   */
  useEffect(() => {
    const root = ref.current
    if (!root) return
    // After paint: a route-lazy page is still a Suspense fallback on this tick.
    const id = requestAnimationFrame(() => {
      const target =
        root.querySelector<HTMLElement>('[data-autofocus]') ?? root
      target.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(id)
  }, [loc.pathname])

  return (
    <div
      key={loc.pathname}
      ref={ref}
      tabIndex={-1}
      // The container is a focus target, not a visible control — the page's own
      // heading is the visual cue that it changed.
      className="animate-fade-in focus:outline-none"
    >
      {children}
    </div>
  )
}
