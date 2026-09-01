import { NavLink, Outlet, useNavigate, useLocation as useRouterLocation } from 'react-router-dom'
import { Suspense, useState, useRef, useEffect, useMemo, useCallback } from 'react'
import {
  ChevronDown,
  MapPin,
  Check,
  User,
  LogOut,
  Sun,
  Moon,
  Globe,
  Loader2,
  Menu,
  X,
} from 'lucide-react'
import { useTheme } from 'next-themes'
import { cn } from '../lib/utils'
import { useLocation as useAppLocation } from '../contexts/LocationContext'
import { PageTransition } from './ui/PageTransition'
import NotificationBell from '../pages/notifications/NotificationBell'
import { HotkeyProvider, useHotkeys, type HotkeyHandler } from '../contexts/HotkeyContext'
import { HotkeyBar } from './HotkeyBar'
import { CommandPalette } from './CommandPalette'
import { ShortcutHelp } from './ShortcutHelp'

import { menuGroups, allItems, type MenuGroup } from '../lib/navigation'
import { ConfirmDialog } from './ui/ConfirmDialog'

/**
 * Shell chords that are bound in GlobalNavShortcuts but belong to a screen
 * rather than to a voucher, so nothing in the nav tree advertises them.
 *
 * A multi-item group hangs the keycap on the menu item it activates, the same
 * way the voucher F-keys are advertised. A single-destination group renders no
 * dropdown at all — `hasSubs` is false, so the panel holding the keycaps never
 * mounts — which left `/` → Ctrl+G as markup nothing could reach. Those groups
 * announce their chord on the group button itself instead.
 */
const SHELL_KEYCAP: Record<string, string> = {
  '/setup': 'F11',
  '/': 'Ctrl+G',
}

/** Ring shared by every bare <button> in the shell — none of them is <Button>. */
const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]'
const FOCUS_RING_INSET =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--brand)]'

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

function menuItems(panel: HTMLElement | null): HTMLElement[] {
  if (!panel) return []
  return Array.from(panel.querySelectorAll<HTMLElement>('[role="menuitem"]'))
}

function focusMenuItem(panel: HTMLElement | null, index: number) {
  const items = menuItems(panel)
  if (items.length === 0) return
  const i = ((index % items.length) + items.length) % items.length
  items[i]?.focus()
}

/**
 * The keyboard contract of an open dropdown: Arrow/Home/End move the
 * highlight, Escape closes it and hands focus BACK to the button that opened
 * it (otherwise the next Tab restarts from the top of the document), and Tab
 * leaves — taking the panel with it rather than abandoning it open behind the
 * page. Escape also stops propagating: on the same keystroke the page's own
 * "Escape goes back" would otherwise fire behind the menu the user was
 * actually dismissing.
 *
 * Tab closes and returns to the trigger rather than walking on: the item
 * holding focus is about to unmount, and letting the browser move from a
 * disappearing node drops focus to <body>.
 */
function handleMenuKeys(
  e: React.KeyboardEvent,
  panel: HTMLElement | null,
  close: (restoreFocus: boolean) => void,
) {
  const items = menuItems(panel)
  const current = items.indexOf(document.activeElement as HTMLElement)
  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault()
      focusMenuItem(panel, current + 1)
      break
    case 'ArrowUp':
      e.preventDefault()
      focusMenuItem(panel, current - 1)
      break
    case 'Home':
      e.preventDefault()
      focusMenuItem(panel, 0)
      break
    case 'End':
      e.preventDefault()
      focusMenuItem(panel, items.length - 1)
      break
    case 'Escape':
      e.preventDefault()
      e.stopPropagation()
      close(true)
      break
    case 'Tab':
      e.preventDefault()
      close(true)
      break
    default:
  }
}

function Wordmark() {
  return (
    <span
      style={{
        fontFamily: 'Inter, system-ui, sans-serif',
        fontWeight: 700,
        fontSize: 18,
        letterSpacing: '-0.04em',
        lineHeight: 1,
        display: 'inline-flex',
        alignItems: 'baseline',
        flexShrink: 0,
      }}
    >
      <span style={{ color: 'var(--ink)' }}>seef</span>
      <span style={{ color: 'var(--brand)' }}>med</span>
      <span style={{ color: 'var(--brand)' }}>.</span>
    </span>
  )
}

function LocationSelector() {
  const { locations, activeLocationId, activeLocation, canSeeAll, isLoading, setActiveLocation } =
    useAppLocation()
  const [open, setOpen] = useState(false)
  const { pathname } = useRouterLocation()
  const ref = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false)
    if (restoreFocus) triggerRef.current?.focus()
  }, [])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  // The voucher F-keys are in NAVIGATION_CHORDS, so they fire from inside this
  // panel too — F5 with the store list open navigated and left the panel
  // hanging over the new page with focus still on a store row. Focus is NOT
  // pulled back to the trigger: the screen that just mounted owns it now.
  useEffect(() => {
    setOpen(false)
  }, [pathname])

  // In a multi-location app every request carries X-Location-Id, which makes
  // this the most-used control in the shell — and until now it could only be
  // dismissed with the mouse. Focus moves into the panel on open so the arrow
  // keys have something to move, and Escape (handled in handleMenuKeys) puts
  // focus back on the trigger.
  useEffect(() => {
    if (!open) return
    const id = requestAnimationFrame(() => focusMenuItem(panelRef.current, 0))
    return () => cancelAnimationFrame(id)
  }, [open])

  if (isLoading) {
    return (
      <div
        className="h-6 w-28 rounded-md animate-pulse"
        style={{ backgroundColor: 'var(--color-hover-bg)' }}
      />
    )
  }

  const label = activeLocation ? activeLocation.name : canSeeAll ? 'All Stores' : 'No Store'

  return (
    // `static` below lg hands the panel's containing block up to the <nav>,
    // which is fixed and spans the viewport — so the panel drops flush under
    // the bar from the screen's left edge. Anchoring to this button instead
    // would push a 260px panel off a 320px screen, since below lg the button
    // sits mid-bar behind the hamburger and wordmark.
    <div className="static lg:relative min-w-0" ref={ref}>
      <button
        ref={triggerRef}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault()
            setOpen(true)
          } else if (e.key === 'Escape' && open) {
            e.preventDefault()
            e.stopPropagation()
            close(false)
          }
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Switch store — currently ${label}`}
        // py-1 is a touch-target bump; lg keeps the original 2px so the
        // desktop bar is unchanged.
        className={cn(
          'flex items-center gap-1 max-w-full px-2 py-1 lg:py-0.5 rounded-md text-xs font-medium hover:bg-[var(--color-hover-bg)]',
          FOCUS_RING,
        )}
        style={{
          color: 'var(--ink)',
          border: '1px solid var(--line)',
          background: 'var(--surface-0)',
        }}
      >
        <MapPin className="w-3 h-3 flex-shrink-0" style={{ color: 'var(--brand)' }} />
        <span className="max-w-[90px] sm:max-w-[110px] truncate">{label}</span>
        <ChevronDown className={cn('w-3 h-3 flex-shrink-0 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div
          ref={panelRef}
          role="menu"
          aria-label="Switch store"
          onKeyDown={(e) => handleMenuKeys(e, panelRef.current, close)}
          className="absolute top-full left-2 lg:left-0 mt-1 rounded-lg shadow-lg py-1 min-w-[220px] max-w-[calc(100vw-1rem)] lg:max-w-none z-50 dropdown-animate"
          style={{ backgroundColor: 'var(--surface-0)', border: '1px solid var(--line)' }}
        >
          <div
            className="px-3 py-2 mono uppercase"
            style={{ fontSize: 10, color: 'var(--ink-3)', letterSpacing: '0.1em', fontWeight: 600 }}
          >
            Switch Store
          </div>
          {canSeeAll && (
            <button
              role="menuitem"
              onClick={() => {
                setActiveLocation(null)
                close(true)
              }}
              className={cn(
                'w-full text-left px-4 py-2 text-sm flex items-center justify-between hover:translate-x-0.5 transition-transform',
                FOCUS_RING_INSET,
              )}
              style={
                activeLocationId === null
                  ? { color: 'var(--brand)', backgroundColor: 'rgba(15, 157, 154, 0.08)', fontWeight: 500 }
                  : { color: 'var(--ink)' }
              }
            >
              <span className="flex items-center gap-2">
                <Globe className="w-4 h-4" /> All Stores
              </span>
              {activeLocationId === null && (
                <Check className="w-4 h-4" style={{ color: 'var(--brand)' }} />
              )}
            </button>
          )}
          {locations.map((loc) => (
            <button
              key={loc.id}
              role="menuitem"
              onClick={() => {
                setActiveLocation(loc.id)
                close(true)
              }}
              className={cn(
                'w-full text-left px-4 py-2 text-sm flex items-center justify-between hover:translate-x-0.5 transition-transform',
                FOCUS_RING_INSET,
              )}
              style={
                activeLocationId === loc.id
                  ? { color: 'var(--brand)', backgroundColor: 'rgba(15, 157, 154, 0.08)', fontWeight: 500 }
                  : { color: 'var(--ink)' }
              }
            >
              <span className="truncate">{loc.name}</span>
              {activeLocationId === loc.id && (
                <Check className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--brand)' }} />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Slide-in navigation for viewports below `lg`, where eight top-level
 * groups cannot share a single bar. Same menu tree as the desktop nav,
 * rendered as an accordion so a 40-item map reads as eight rows until
 * you open one. The group holding the current page starts expanded.
 */
function MobileNavDrawer({
  open,
  onClose,
  onRequestLogout,
  activeItemId,
}: {
  open: boolean
  onClose: () => void
  onRequestLogout: () => void
  activeItemId: string | null
}) {
  const { theme, setTheme } = useTheme()
  const activeGroup = useMemo(
    () => menuGroups.find((g) => allItems(g).some((i) => i.id === activeItemId))?.label ?? null,
    [activeItemId]
  )
  const [expanded, setExpanded] = useState<string | null>(activeGroup)
  const panelRef = useRef<HTMLDivElement>(null)
  // `onClose` is passed inline by TopNav, so its identity changes every
  // render. Held in a ref so the effect below keys on `open` alone — keyed on
  // the callback it would re-capture the trigger and re-run the focus dance
  // on every parent render.
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  // Re-sync the open section whenever the drawer is reopened on a new page.
  useEffect(() => {
    if (open) setExpanded(activeGroup)
  }, [open, activeGroup])

  /**
   * Hold the page still behind the drawer, and make it a real modal for the
   * keyboard: focus moves in, Tab cycles inside it, and closing hands focus
   * back to the hamburger that opened it.
   *
   * Without the trap, Tab from the still-focused hamburger walked into the
   * page *behind* the overlay — a keyboard user was reading one screen and
   * operating another. Without the restore, closing left focus on an
   * unmounted node, so the next Tab started again from the top of the page.
   */
  useEffect(() => {
    if (!open) return
    const trigger = document.activeElement as HTMLElement | null
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const raf = requestAnimationFrame(() => {
      panelRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus()
    })

    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        // Stop here: the page underneath must not also treat this as "go back".
        e.stopPropagation()
        onCloseRef.current()
        return
      }
      if (e.key !== 'Tab') return
      const panel = panelRef.current
      if (!panel) return
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE))
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement as HTMLElement | null
      const inside = !!active && panel.contains(active)
      if (e.shiftKey && (!inside || active === first)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && (!inside || active === last)) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleKey, true)
    return () => {
      cancelAnimationFrame(raf)
      document.body.style.overflow = prevOverflow
      document.removeEventListener('keydown', handleKey, true)
      trigger?.focus?.()
    }
  }, [open])

  if (!open) return null

  return (
    <div className="lg:hidden">
      <div
        className="fixed inset-0 z-50 bg-black/40 animate-fade-in"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Main menu"
        // Marks the drawer the way Radix marks its overlays, so the app-wide
        // `[role="dialog"][data-state="open"]` guards (useEscapeBack,
        // shouldIgnoreEvent) recognise it as the thing that owns Escape.
        data-state="open"
        className="fixed inset-y-0 left-0 z-50 w-[min(20rem,85vw)] flex flex-col shadow-xl animate-slide-in-left"
        style={{ backgroundColor: 'var(--surface-0)', borderRight: '1px solid var(--line)' }}
      >
        <div
          className="h-14 px-4 flex items-center justify-between border-b flex-shrink-0"
          style={{ borderColor: 'var(--line)' }}
        >
          <Wordmark />
          <button
            onClick={onClose}
            className={cn(
              'w-9 h-9 -mr-2 rounded-md flex items-center justify-center hover:bg-[var(--color-hover-bg)]',
              FOCUS_RING,
            )}
            style={{ color: 'var(--ink-2)' }}
            aria-label="Close menu"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto py-2 overscroll-contain">
          {menuGroups.map((group) => {
            const items = allItems(group)
            const Icon = group.icon
            const groupActive = items.some((i) => i.id === activeItemId)

            // Gateway and Dashboard are single destinations — no accordion.
            if (items.length === 1) {
              return (
                <NavLink
                  key={group.label}
                  to={items[0].to}
                  end={items[0].to === '/'}
                  onClick={onClose}
                  className="flex items-center gap-3 px-4 h-11 text-sm font-medium"
                  style={
                    groupActive
                      ? { color: 'var(--brand)', backgroundColor: 'rgba(15, 157, 154, 0.08)' }
                      : { color: 'var(--ink)' }
                  }
                >
                  <Icon className="w-4 h-4 flex-shrink-0" />
                  {group.label}
                </NavLink>
              )
            }

            const isExpanded = expanded === group.label
            return (
              <div key={group.label}>
                <button
                  onClick={() => setExpanded(isExpanded ? null : group.label)}
                  aria-expanded={isExpanded}
                  className={cn('w-full flex items-center gap-3 px-4 h-11 text-sm font-medium', FOCUS_RING_INSET)}
                  style={{ color: groupActive ? 'var(--brand)' : 'var(--ink)' }}
                >
                  <Icon className="w-4 h-4 flex-shrink-0" />
                  <span className="flex-1 text-left">{group.label}</span>
                  <ChevronDown
                    className={cn('w-4 h-4 flex-shrink-0 transition-transform', isExpanded && 'rotate-180')}
                    style={{ color: 'var(--ink-3)' }}
                  />
                </button>

                {isExpanded && (
                  <div className="pb-1" style={{ backgroundColor: 'var(--surface-1)' }}>
                    {group.sections.map((section, sectionIdx) => (
                      <div key={section.title ?? `s${sectionIdx}`}>
                        {section.title && (
                          <div
                            className="px-4 pt-2.5 pb-1 mono uppercase"
                            style={{
                              fontSize: 10,
                              color: 'var(--ink-3)',
                              letterSpacing: '0.1em',
                              fontWeight: 600,
                            }}
                          >
                            {section.title}
                          </div>
                        )}
                        {section.items.map((item) => {
                          const itemActive = item.id === activeItemId
                          return (
                            <NavLink
                              key={item.id}
                              to={item.to}
                              end={item.to === '/'}
                              onClick={onClose}
                              className="flex items-center pl-11 pr-4 h-10 text-sm"
                              style={
                                itemActive
                                  ? { color: 'var(--brand)', fontWeight: 500 }
                                  : { color: 'var(--ink-2)' }
                              }
                            >
                              {item.label}
                            </NavLink>
                          )
                        })}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </nav>

        <div
          className="flex-shrink-0 border-t px-2 pt-2 safe-bottom"
          style={{ borderColor: 'var(--line)' }}
        >
          <button
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className={cn(
              'w-full flex items-center gap-3 px-2 h-11 rounded-md text-sm hover:bg-[var(--color-hover-bg)]',
              FOCUS_RING,
            )}
            style={{ color: 'var(--ink-2)' }}
          >
            {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            {theme === 'dark' ? 'Light mode' : 'Dark mode'}
          </button>
          <button
            onClick={onRequestLogout}
            className={cn(
              'w-full flex items-center gap-3 px-2 h-11 rounded-md text-sm hover:bg-[var(--color-hover-bg)]',
              FOCUS_RING,
            )}
            style={{ color: 'var(--danger)' }}
          >
            <LogOut className="w-4 h-4" />
            Sign out
          </button>
        </div>
      </div>
    </div>
  )
}

function findActiveItemId(path: string): string | null {
  let bestId: string | null = null
  let bestLen = -1
  for (const g of menuGroups) {
    for (const item of allItems(g)) {
      if (item.to === '/') {
        if (path === '/' && bestLen < 1) { bestId = item.id; bestLen = 1 }
        continue
      }
      if (path === item.to || path.startsWith(item.to + '/')) {
        if (item.to.length > bestLen) { bestId = item.id; bestLen = item.to.length }
      }
    }
  }
  return bestId
}

function TopNav() {
  const navigate = useNavigate()
  const routerLoc = useRouterLocation()
  const { theme, setTheme } = useTheme()
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const [showProfile, setShowProfile] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [confirmLogout, setConfirmLogout] = useState(false)
  const navRef = useRef<HTMLElement>(null)
  const groupBtnRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  // Only one dropdown is ever open, so one ref is enough for whichever it is.
  const menuPanelRef = useRef<HTMLDivElement | null>(null)
  const profileBtnRef = useRef<HTMLButtonElement>(null)
  const profilePanelRef = useRef<HTMLDivElement>(null)
  const hamburgerRef = useRef<HTMLButtonElement>(null)
  // The control that asked to sign out, so Cancel can hand focus back to it.
  // Its panel is closed before the dialog opens, so the node Radix would
  // restore to is already gone by then.
  const logoutReturnRef = useRef<HTMLElement | null>(null)
  const activeItemId = useMemo(() => findActiveItemId(routerLoc.pathname), [routerLoc.pathname])

  // Mirrors `openMenu` so closeMenu can read which button to hand focus back
  // to without taking the state as a dependency.
  const openMenuRef = useRef<string | null>(null)
  openMenuRef.current = openMenu

  const closeMenu = useCallback((restoreFocus: boolean) => {
    const label = openMenuRef.current
    setOpenMenu(null)
    if (restoreFocus && label) groupBtnRefs.current[label]?.focus()
  }, [])

  const closeProfile = useCallback((restoreFocus: boolean) => {
    setShowProfile(false)
    if (restoreFocus) profileBtnRef.current?.focus()
  }, [])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (navRef.current && !navRef.current.contains(e.target as Node)) {
        setOpenMenu(null)
        setShowProfile(false)
      }
    }
    /**
     * Capture phase, and it stops propagating: Escape over an open dropdown
     * used to close the menu AND run the page's own "Escape goes back" on the
     * same press, so dismissing a menu left the screen. Closing here also
     * returns focus to the button that opened the panel — `setOpenMenu(null)`
     * alone unmounts the focused NavLink and drops focus to <body>.
     */
    function handleEscape(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      if (openMenu) {
        e.stopPropagation()
        closeMenu(true)
      } else if (showProfile) {
        e.stopPropagation()
        closeProfile(true)
      }
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleEscape, true)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleEscape, true)
    }
  }, [openMenu, showProfile, closeMenu, closeProfile])

  // A dropdown that opens without focus is a dropdown the keyboard cannot
  // reach — the arrow keys need something to move from.
  useEffect(() => {
    if (!openMenu) return
    const id = requestAnimationFrame(() => focusMenuItem(menuPanelRef.current, 0))
    return () => cancelAnimationFrame(id)
  }, [openMenu])

  useEffect(() => {
    if (!showProfile) return
    const id = requestAnimationFrame(() => focusMenuItem(profilePanelRef.current, 0))
    return () => cancelAnimationFrame(id)
  }, [showProfile])

  // The global F-keys stay live while a menu or the drawer is open, so an
  // F-key navigation would leave the panel hanging over the new page.
  useEffect(() => {
    setOpenMenu(null)
    setShowProfile(false)
    setDrawerOpen(false)
  }, [routerLoc.pathname])

  /**
   * ArrowLeft/Right along the bar, ArrowDown into the open group's menu.
   *
   * No chord reaches the bar itself, on purpose. The one that used to — a
   * global Alt+M bound here with a raw `document.addEventListener` — is gone.
   * Alt+M is not in the app's chord map, and GatewayPage already binds Alt+M
   * as a page chord ("Masters"). Both listeners sat on `document` in the
   * bubble phase, so `preventDefault` suppressed neither: one press focused a
   * nav group AND the Masters grid, with the winner decided by a registration
   * order that flipped on every navigation. The bar is a normal tab stop and
   * ←/→ walk it from there; putting a nav chord back means first adding it to
   * the shared chord map and to GLOBAL_HINTS / the F1 catalogue, so it is
   * both unambiguous and findable.
   */
  function handleGroupKeyDown(e: React.KeyboardEvent, index: number, group: MenuGroup) {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault()
      const step = e.key === 'ArrowRight' ? 1 : -1
      const next = (index + step + menuGroups.length) % menuGroups.length
      groupBtnRefs.current[menuGroups[next].label]?.focus()
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault()
      const target = e.key === 'Home' ? 0 : menuGroups.length - 1
      groupBtnRefs.current[menuGroups[target].label]?.focus()
    } else if (e.key === 'ArrowDown' && allItems(group).length > 1) {
      e.preventDefault()
      setOpenMenu(group.label)
    }
  }

  function handleLogout() {
    localStorage.removeItem('token')
    localStorage.removeItem('refresh_token')
    setConfirmLogout(false)
    navigate('/login')
  }

  /**
   * Sign Out is the only item in the account panel, and the panel focuses its
   * first item on open — so ArrowDown from the account button landed straight
   * on it and a reflexive Enter ended the session, with no click target and no
   * question asked. It goes through the shared confirm now, which for a danger
   * tone opens with Cancel focused: the key a slipped finger repeats is the
   * safe one. The panel closes first so the dialog is the only overlay, and
   * `logoutReturnRef` remembers where focus came from.
   */
  const requestLogout = useCallback((returnTo: HTMLElement | null) => {
    logoutReturnRef.current = returnTo
    setOpenMenu(null)
    setShowProfile(false)
    setDrawerOpen(false)
    setConfirmLogout(true)
  }, [])

  function isGroupActive(group: MenuGroup) {
    return activeItemId !== null && allItems(group).some((item) => item.id === activeItemId)
  }

  function handleGroupClick(group: MenuGroup) {
    const items = allItems(group)
    if (items.length === 1) {
      navigate(items[0].to)
      setOpenMenu(null)
    } else {
      setOpenMenu(openMenu === group.label ? null : group.label)
    }
    setShowProfile(false)
  }

  return (
    <>
    <nav
      ref={navRef}
      className="h-14 lg:h-16 backdrop-blur-lg border-b fixed top-0 left-0 right-0 z-40 flex items-center px-2 sm:px-3 gap-1"
      style={{ backgroundColor: 'var(--color-nav-bg)', borderColor: 'var(--color-nav-border)' }}
    >
      {/* Below lg the eight groups move into a drawer. */}
      <button
        ref={hamburgerRef}
        onClick={() => setDrawerOpen(true)}
        className={cn(
          'lg:hidden w-9 h-9 -ml-1 rounded-md flex items-center justify-center flex-shrink-0 hover:bg-[var(--color-hover-bg)]',
          FOCUS_RING,
        )}
        style={{ color: 'var(--ink-2)' }}
        aria-label="Open menu"
        aria-haspopup="dialog"
        aria-expanded={drawerOpen}
      >
        <Menu className="w-5 h-5" />
      </button>

      {/* Brand + store selector: side by side while the bar is mostly empty,
          stacked once the desktop menu needs the horizontal room. */}
      <div className="flex items-center gap-2 min-w-0 lg:flex-col lg:justify-center lg:items-start lg:gap-1 lg:mr-3 flex-shrink lg:flex-shrink-0">
        {/* Wordmark carries its own flex-shrink-0 — wrapping it in a span
            would put it in a 24px line box and grow the column by 6px. */}
        <Wordmark />
        <LocationSelector />
      </div>

      {/* Pushes the right-hand cluster to the edge while the menu is hidden. */}
      <div className="flex-1 lg:hidden" />

      {/* Menu Groups — flex-1 children with min-w-0 so they shrink and labels
          truncate instead of overflowing the bar on narrow / 100%-zoom screens. */}
      <div className="hidden lg:flex items-center flex-1 min-w-0 gap-0.5">
        {menuGroups.map((group, groupIndex) => {
          const active = isGroupActive(group)
          const isOpen = openMenu === group.label
          const groupItems = allItems(group)
          const hasSubs = groupItems.length > 1
          // Gateway is a single destination: clicking the button navigates and
          // no dropdown ever mounts, so its Ctrl+G keycap has nowhere to be
          // rendered. Announce it on the button instead of dropping it.
          const soleKeycap = hasSubs
            ? undefined
            : groupItems[0].keycap ?? SHELL_KEYCAP[groupItems[0].to]
          const Icon = group.icon

          return (
            <div key={group.label} className="relative flex-1 min-w-0 flex justify-center">
              <button
                ref={(el) => {
                  groupBtnRefs.current[group.label] = el
                }}
                onClick={() => handleGroupClick(group)}
                onKeyDown={(e) => handleGroupKeyDown(e, groupIndex, group)}
                aria-haspopup={hasSubs ? 'menu' : undefined}
                aria-expanded={hasSubs ? isOpen : undefined}
                aria-keyshortcuts={soleKeycap}
                title={soleKeycap ? `${group.label} (${soleKeycap})` : undefined}
                className={cn(
                  'relative flex items-center justify-center gap-1 px-2 py-2 rounded-md text-sm font-medium w-full max-w-[150px] min-w-0',
                  FOCUS_RING,
                  !active && 'hover:bg-[var(--color-hover-bg)]'
                )}
                style={
                  active
                    ? { color: 'var(--brand)', backgroundColor: 'rgba(15, 157, 154, 0.08)' }
                    : { color: 'var(--ink-2)' }
                }
              >
                <Icon className="w-4 h-4 flex-shrink-0" />
                <span className="truncate">{group.label}</span>
                {hasSubs && (
                  // The chevron costs ~16px per group — width the bar can't
                  // spare at exactly 1024px, where labels would truncate.
                  <ChevronDown
                    className={cn(
                      'w-3 h-3 flex-shrink-0 transition-transform hidden xl:block',
                      isOpen && 'rotate-180'
                    )}
                  />
                )}
                {active && (
                  <span
                    className="absolute -bottom-[1px] left-1/2 -translate-x-1/2 w-6 h-0.5 rounded-full"
                    style={{ backgroundColor: 'var(--brand)' }}
                  />
                )}
              </button>

              {isOpen && hasSubs && (
                <div
                  ref={menuPanelRef}
                  role="menu"
                  aria-label={group.label}
                  onKeyDown={(e) => handleMenuKeys(e, menuPanelRef.current, closeMenu)}
                  className="absolute top-full left-1/2 -translate-x-1/2 mt-1 rounded-lg shadow-lg py-2 min-w-[260px] z-50 dropdown-animate"
                  style={{ backgroundColor: 'var(--surface-0)', border: '1px solid var(--line)' }}
                >
                  {group.sections.map((section, sectionIdx) => (
                    <div key={section.title ?? `s${sectionIdx}`}>
                      {sectionIdx > 0 && (
                        <div
                          className="my-1 mx-3 border-t"
                          style={{ borderColor: 'var(--line)' }}
                        />
                      )}
                      {section.title && (
                        <div
                          className="px-4 pt-1.5 pb-1 mono uppercase"
                          style={{
                            fontSize: 10,
                            color: 'var(--ink-3)',
                            letterSpacing: '0.1em',
                            fontWeight: 600,
                          }}
                        >
                          {section.title}
                        </div>
                      )}
                      {section.items.map((item) => {
                        const itemActive = item.id === activeItemId
                        // F11 (Setup) and Ctrl+G (Gateway) are bound in
                        // GlobalNavShortcuts but carry no keycap in the nav
                        // tree, so nothing advertised them anywhere.
                        const keycap = item.keycap ?? SHELL_KEYCAP[item.to]
                        return (
                          <NavLink
                            key={item.id}
                            to={item.to}
                            end={item.to === '/'}
                            role="menuitem"
                            aria-keyshortcuts={keycap}
                            onClick={() => setOpenMenu(null)}
                            className={cn(
                              'flex items-center justify-between w-full text-left px-4 py-2 text-sm hover:translate-x-0.5 transition-transform',
                              FOCUS_RING_INSET,
                              itemActive && 'font-medium'
                            )}
                            style={
                              itemActive
                                ? { color: 'var(--brand)', backgroundColor: 'rgba(15, 157, 154, 0.08)' }
                                : { color: 'var(--ink)' }
                            }
                          >
                            <span className="truncate">{item.label}</span>
                            {keycap && (
                              // Keycaps only appear at >=lg (1024px) to keep
                              // dropdown widths sane on narrower viewports.
                              // The shortcut still works — it's just not
                              // visually advertised on the menu item.
                              <kbd
                                className="ml-3 px-1.5 py-0.5 rounded mono text-[10px] uppercase tracking-wider flex-shrink-0 hidden lg:inline-block"
                                style={{
                                  color: 'var(--ink-3)',
                                  border: '1px solid var(--line)',
                                  background: 'var(--surface-1)',
                                }}
                              >
                                {keycap}
                              </kbd>
                            )}
                          </NavLink>
                        )
                      })}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Right: Theme + Profile */}
      <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
        <NotificationBell />
        <button
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          // On phones this lives in the drawer instead — the bar is full.
          className={cn('hidden sm:block p-2 rounded-md hover:bg-[var(--color-hover-bg)]', FOCUS_RING)}
          style={{ color: 'var(--ink-2)' }}
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>

        <div className="relative">
          <button
            ref={profileBtnRef}
            onClick={() => {
              setShowProfile(!showProfile)
              setOpenMenu(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown' && !showProfile) {
                e.preventDefault()
                setShowProfile(true)
                setOpenMenu(null)
              }
            }}
            aria-haspopup="menu"
            aria-expanded={showProfile}
            aria-label="Account menu"
            className={cn('flex items-center gap-2 p-1 rounded-md hover:bg-[var(--color-hover-bg)]', FOCUS_RING)}
          >
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center"
              style={{ backgroundColor: 'var(--brand)' }}
            >
              <User className="w-3.5 h-3.5 text-white" />
            </div>
            <ChevronDown
              className="w-3.5 h-3.5 hidden lg:block"
              style={{ color: 'var(--ink-3)' }}
            />
          </button>

          {showProfile && (
            <div
              ref={profilePanelRef}
              role="menu"
              aria-label="Account"
              onKeyDown={(e) => handleMenuKeys(e, profilePanelRef.current, closeProfile)}
              className="absolute right-0 mt-2 w-56 rounded-xl shadow-xl overflow-hidden z-50 dropdown-animate"
              style={{ backgroundColor: 'var(--surface-0)', border: '1px solid var(--line)' }}
            >
              <div
                className="p-4 border-b"
                style={{
                  borderColor: 'var(--line)',
                  backgroundColor: 'var(--color-grey-light)',
                }}
              >
                <p className="text-sm font-medium" style={{ color: 'var(--ink)' }}>
                  Signed in
                </p>
                <p className="text-xs" style={{ color: 'var(--ink-2)' }}>
                  Seefmed Accounting
                </p>
              </div>
              <div className="py-2">
                <button
                  role="menuitem"
                  onClick={() => requestLogout(profileBtnRef.current)}
                  className={cn(
                    'w-full px-4 py-2.5 text-left text-sm flex items-center gap-3 hover:translate-x-0.5 transition-transform',
                    FOCUS_RING_INSET,
                  )}
                  style={{ color: 'var(--danger)' }}
                >
                  <LogOut className="w-4 h-4" />
                  Sign Out
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </nav>

    {/* Outside the <nav> on purpose: `backdrop-blur` makes the bar the
        containing block for fixed-position descendants, which would pin the
        full-height drawer to the 56px bar. */}
    <MobileNavDrawer
      open={drawerOpen}
      onClose={() => setDrawerOpen(false)}
      onRequestLogout={() => requestLogout(hamburgerRef.current)}
      activeItemId={activeItemId}
    />

    <ConfirmDialog
      open={confirmLogout}
      onOpenChange={(next) => {
        setConfirmLogout(next)
        if (!next) {
          // Radix restores focus to whatever was focused when the dialog
          // mounted — by then the panel holding Sign Out had already gone, so
          // it restores to <body>. Put focus back on the trigger ourselves,
          // after Radix has had its turn.
          const back = logoutReturnRef.current
          requestAnimationFrame(() => back?.focus())
        }
      }}
      title="Sign out?"
      description="You will be returned to the login screen. Anything unsaved on this page is lost."
      confirmLabel="Sign out"
      cancelLabel="Stay signed in"
      tone="danger"
      onConfirm={handleLogout}
    />
    </>
  )
}

function GlobalNavShortcuts({ onHelp }: { onHelp: () => void }) {
  const navigate = useNavigate()
  const handlers = useMemo<HotkeyHandler[]>(() => [
    // F1 is the discovery route into everything else: in a keyboard-only app a
    // shortcut nobody can find does not exist. Registered here, before the
    // page-scoped handlers, so a screen can never shadow it.
    // `always`: F1 is the one chord that must work at any overlay depth. It is
    // registered at the shell (depth 0), and the help sheet it opens is itself
    // an overlay — without this the second F1 was swallowed by the very sheet
    // the first one opened, so the key advertised as a toggle only ever opened.
    { chord: 'F1', preventDefault: true, always: true, handler: onHelp },
    { chord: 'F4', preventDefault: true, handler: () => navigate('/vouchers/contra') },
    { chord: 'F5', preventDefault: true, handler: () => navigate('/vouchers/payment') },
    { chord: 'F6', preventDefault: true, handler: () => navigate('/vouchers/receipt') },
    { chord: 'F7', preventDefault: true, handler: () => navigate('/vouchers/journal') },
    { chord: 'F8', preventDefault: true, handler: () => navigate('/vouchers/sales') },
    { chord: 'F9', preventDefault: true, handler: () => navigate('/vouchers/purchase') },
    { chord: 'Ctrl+F8', preventDefault: true, handler: () => navigate('/vouchers/credit-note') },
    { chord: 'Ctrl+F9', preventDefault: true, handler: () => navigate('/vouchers/debit-note') },
    { chord: 'F11', preventDefault: true, handler: () => navigate('/setup') },
    // Tally's own "back to the Gateway" key. Ctrl+G rather than plain G so it
    // survives inside a text field, where the whole point is to leave.
    { chord: 'Ctrl+G', preventDefault: true, handler: () => navigate('/') },
  ], [navigate, onHelp])
  useHotkeys(handlers)
  return null
}

function RouteLoadingFallback() {
  // Shown while a route-lazy page chunk downloads (pages are code-split in
  // App.tsx). Same spinner the pages themselves use while fetching data.
  return (
    <div className="flex items-center justify-center py-24">
      <Loader2 size={28} className="animate-spin" style={{ color: 'var(--brand)' }} />
    </div>
  )
}

export default function Layout() {
  const { activeLocationId } = useAppLocation()
  const [helpOpen, setHelpOpen] = useState(false)
  const openHelp = useCallback(() => setHelpOpen((v) => !v), [])
  const { pathname } = useRouterLocation()
  // The global F-keys stay live while the help sheet is open, so F5 would
  // navigate to the Payment voucher and leave the overlay covering it, still
  // holding focus. Navigating dismisses it.
  useEffect(() => { setHelpOpen(false) }, [pathname])
  return (
    <HotkeyProvider>
      <div className="min-h-screen" style={{ backgroundColor: 'var(--surface-1)' }}>
        <TopNav />
        <GlobalNavShortcuts onHelp={openHelp} />
        {/* Top padding clears the fixed nav (h-14 / lg:h-16); bottom padding
            clears the F-key bar, which only exists from md up. */}
        <main className="px-3 sm:px-4 lg:px-6 pt-[4.5rem] lg:pt-20 pb-8 md:pb-14">
          {/* Keyed by store: switching the store remounts the routed page so
              every screen refetches with the new X-Location-Id. */}
          <PageTransition key={activeLocationId ?? 'all'}>
            {/* The ONE Suspense boundary for all route-lazy pages. */}
            <Suspense fallback={<RouteLoadingFallback />}>
              <Outlet />
            </Suspense>
          </PageTransition>
        </main>
        <HotkeyBar onHelp={openHelp} />
        <CommandPalette />
        <ShortcutHelp open={helpOpen} onOpenChange={setHelpOpen} />
      </div>
    </HotkeyProvider>
  )
}
