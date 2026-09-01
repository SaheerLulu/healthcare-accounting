import * as React from 'react'
import * as TabsPrimitive from '@radix-ui/react-tabs'
import { useHotkeys, type HotkeyHandler } from '../../contexts/HotkeyContext'
import { type Chord } from '../../lib/shortcuts'
import { cn } from '../../lib/utils'

const Tabs = TabsPrimitive.Root

/**
 * Radix already gives the strip its roving tabindex and Arrow/Home/End
 * movement — what it cannot supply is a NAME. Focus landing on an unnamed
 * `role="tablist"` announces nothing, so pass `label`; the fallback exists
 * only so an un-updated caller is not left worse off than before.
 */
const TabsList = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List> & { label?: string }
>(({ className, label, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    aria-label={label ?? props['aria-label'] ?? 'Views'}
    className={cn(
      // `max-w-full` + scroll keeps a long tab strip on one line at phone
      // widths rather than wrapping into a two-row block.
      'flex gap-1 mb-5 bg-slate-100 rounded-lg p-1 w-fit max-w-full overflow-x-auto',
      className
    )}
    {...props}
  />
))
TabsList.displayName = 'TabsList'

/**
 * One tab's chord, bound through HotkeyContext like every other chord in the
 * app.
 *
 * It used to be a bespoke `document.addEventListener('keydown')` that checked
 * for an open dialog itself. That check is a re-implementation of the central
 * overlay gate and a worse one: it fired from inside a focused field, so
 * Alt+<n> switched tabs — and threw away whatever the field was holding —
 * mid-edit. Going through the context means the strip inherits the real rules:
 * the overlay DEPTH gate (a strip behind a dialog cannot fire, a strip INSIDE
 * one still can), and `shouldIgnoreEvent`, which leaves Alt+<digit> to the
 * input, textarea or select that has focus. Switching away from typed-in text
 * is now a deliberate act, and a consumer holding unsaved edits can still
 * confirm the switch (see SettingsPage) for the paths that remain.
 *
 * Renders nothing, and is mounted only for a trigger that declares a chord —
 * so a tab strip on a screen outside the shell (no HotkeyProvider) is
 * unaffected, as long as it does not ask for chords.
 */
function TabChord({ chord, onFire }: { chord: Chord; onFire: () => void }) {
  const fire = React.useRef(onFire)
  fire.current = onFire
  const handlers = React.useMemo<HotkeyHandler[]>(
    () => [{ chord, preventDefault: true, handler: () => fire.current() }],
    [chord]
  )
  useHotkeys(handlers)
  return null
}

/**
 * `chord` makes one tab reachable from anywhere on the screen — including
 * from deep inside another panel, where switching view otherwise means
 * Shift+Tabbing all the way back out to the strip. The keycap renders on the
 * trigger itself, next to the label, because a shortcut nobody can see does
 * not exist; `aria-keyshortcuts` says the same thing to a screen reader.
 *
 * The chord registers handlers only — never hints. The hint bar is a
 * per-SCREEN register, so publishing from here would wipe whatever the page
 * put there.
 */
const TabsTrigger = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger> & { chord?: Chord }
>(({ className, chord, children, ...props }, ref) => {
  const innerRef = React.useRef<HTMLButtonElement | null>(null)

  return (
    <TabsPrimitive.Trigger
      ref={(node) => {
        innerRef.current = node
        if (typeof ref === 'function') ref(node)
        else if (ref) ref.current = node
      }}
      aria-keyshortcuts={chord}
      className={cn(
        'px-3 sm:px-4 py-1.5 text-sm font-medium rounded-md text-slate-500 transition-all whitespace-nowrap flex-shrink-0',
        // Radix moves focus between triggers with the arrow keys, so the strip
        // needs a visible "you are here" of its own.
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--brand)]',
        'data-[state=active]:bg-white data-[state=active]:text-teal-600 data-[state=active]:shadow-sm',
        chord && 'inline-flex items-center gap-1.5',
        className
      )}
      {...props}
    >
      {chord && (
        <TabChord
          chord={chord}
          /**
           * Drive the switch the way Radix actually listens for it.
           *
           * `el.click()` looks right and does nothing: TabsPrimitive.Trigger
           * binds activation to onMouseDown / onKeyDown / onFocus and never to
           * onClick, so HTMLElement.click() dispatches an event nobody reads.
           * The tab only changed as a side effect of focus() hitting automatic
           * activation — which meant the chord was a no-op under
           * activationMode="manual", and a no-op again whenever the trigger
           * already held focus without being selected (exactly the state a
           * vetoed switch leaves behind).
           *
           * Focus first so the strip shows where the user is, then dispatch a
           * real mousedown, which is what routes through the strip's own
           * onValueChange — so a consumer that vetoes the switch on unsaved
           * edits vetoes the chord too.
           */
          onFire={() => {
            const el = innerRef.current
            if (!el || el.hasAttribute('disabled')) return
            el.focus()
            el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
          }}
        />
      )}
      {children}
      {chord && (
        <kbd
          className="mono text-[10px] px-1 py-0.5 rounded hidden lg:inline-block"
          style={{
            color: 'var(--ink-3)',
            border: '1px solid var(--line)',
            background: 'var(--surface-1)',
          }}
        >
          {chord}
        </kbd>
      )}
    </TabsPrimitive.Trigger>
  )
})
TabsTrigger.displayName = 'TabsTrigger'

const TabsContent = TabsPrimitive.Content

export { Tabs, TabsList, TabsTrigger, TabsContent }
