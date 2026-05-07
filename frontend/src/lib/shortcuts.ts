/**
 * Tally-style keyboard chord matcher.
 *
 * A "chord" is a string like "F5", "Ctrl+A", "Ctrl+F8", "Alt+C", "Ctrl+H", "Esc".
 * Comparison is case-insensitive on the key portion; modifiers are order-free.
 */

export type Chord = string

export interface ChordParts {
  ctrl: boolean
  alt: boolean
  shift: boolean
  meta: boolean
  key: string
}

/** Normalize a `KeyboardEvent` into the chord parts we compare. */
export function eventChord(e: KeyboardEvent): ChordParts {
  return {
    ctrl: e.ctrlKey,
    alt: e.altKey,
    shift: e.shiftKey,
    meta: e.metaKey,
    key: e.key,
  }
}

/** Parse "Ctrl+Shift+F8" → ChordParts. */
export function parseChord(chord: Chord): ChordParts {
  const tokens = chord.split('+').map((s) => s.trim())
  let ctrl = false, alt = false, shift = false, meta = false
  let key = ''
  for (const t of tokens) {
    const tl = t.toLowerCase()
    if (tl === 'ctrl' || tl === 'control') ctrl = true
    else if (tl === 'alt' || tl === 'option') alt = true
    else if (tl === 'shift') shift = true
    else if (tl === 'meta' || tl === 'cmd' || tl === 'command') meta = true
    else key = t
  }
  return { ctrl, alt, shift, meta, key }
}

/** True when the keyboard event matches the chord. */
export function chordMatches(chord: Chord, e: KeyboardEvent): boolean {
  const want = parseChord(chord)
  const got = eventChord(e)
  if (want.ctrl !== got.ctrl) return false
  if (want.alt !== got.alt) return false
  if (want.shift !== got.shift) return false
  if (want.meta !== got.meta) return false
  return keyEquals(want.key, got.key)
}

function keyEquals(want: string, got: string): boolean {
  if (!want) return false
  // F1..F12 — case-insensitive direct match
  if (/^F\d{1,2}$/i.test(want)) return want.toUpperCase() === got.toUpperCase()
  // Special keys
  const map: Record<string, string> = {
    esc: 'Escape',
    escape: 'Escape',
    enter: 'Enter',
    return: 'Enter',
    space: ' ',
    tab: 'Tab',
    up: 'ArrowUp',
    down: 'ArrowDown',
    left: 'ArrowLeft',
    right: 'ArrowRight',
  }
  const w = map[want.toLowerCase()] || want
  // Single-letter chord: compare uppercase to handle Shift / capslock
  if (w.length === 1) return w.toUpperCase() === got.toUpperCase()
  return w === got
}

/**
 * Decide whether the listener should bail out because focus is inside an input.
 * Allow-list lets navigation chords (F-keys, Ctrl+chords, Alt+, Esc) work even
 * when an input is focused.
 */
export function shouldIgnoreEvent(e: KeyboardEvent, allowList: Chord[]): boolean {
  // Always allow if a chord in the allow-list matches.
  if (allowList.some((c) => chordMatches(c, e))) return false

  const target = e.target as HTMLElement | null
  if (!target) return false
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (target.isContentEditable) return true
  // Inside a Radix dropdown / dialog / listbox we want to defer to the widget.
  const role = target.closest('[role="menu"], [role="listbox"], [role="dialog"]')
  if (role) return true
  return false
}

/** F-key + chord global navigation map. Updated by Layout via routeMap. */
export const NAVIGATION_CHORDS: Chord[] = [
  'F1',
  'F2',
  'F4',
  'F5',
  'F6',
  'F7',
  'F8',
  'F9',
  'F11',
  'Ctrl+F8',
  'Ctrl+F9',
  'Ctrl+K',
]

/** Chords that should fire regardless of focused element (Tally muscle-memory). */
export const GLOBAL_ALLOW_LIST: Chord[] = [
  ...NAVIGATION_CHORDS,
  'Ctrl+A',
  'Ctrl+H',
  'Alt+C',
  'Alt+P',
  'Alt+E',
  'Alt+R',
  'Escape',
]
