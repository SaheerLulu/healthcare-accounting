import { NavLink, Outlet, useNavigate, useLocation as useRouterLocation } from 'react-router-dom'
import { Suspense, useState, useRef, useEffect, useMemo } from 'react'
import {
  LayoutDashboard,
  BookOpen,
  Receipt,
  FileBarChart,
  ChevronDown,
  MapPin,
  Check,
  User,
  LogOut,
  Sun,
  Moon,
  Globe,
  Users,
  Landmark,
  Home,
  ArrowLeftRight,
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

interface MenuItem {
  id: string
  label: string
  to: string
  keycap?: string
}

interface MenuSection {
  /** Section header inside a dropdown; omit for "ungrouped" sections. */
  title?: string
  items: MenuItem[]
}

interface MenuGroup {
  label: string
  icon: React.ComponentType<{ className?: string }>
  sections: MenuSection[]
}

// Reduced from 10 to 8 top-level entries (2 standalone + 6 grouped) by
// merging Ledger/Bills/Vouchers into Books+Transactions, Banking+Assets,
// GST+TDS+Payroll into Tax & Compliance, and dissolving the "More" bucket
// into Reports & Admin. Each long dropdown is split into named sections
// so a 14-item menu reads as 3 mini-groups instead of a wall of text.
const menuGroups: MenuGroup[] = [
  {
    label: 'Gateway',
    icon: Home,
    sections: [{ items: [{ id: 'gateway', label: 'Gateway of Tally', to: '/' }] }],
  },
  {
    label: 'Dashboard',
    icon: LayoutDashboard,
    sections: [{ items: [{ id: 'dashboard', label: 'Dashboard', to: '/dashboard' }] }],
  },
  {
    label: 'Books',
    icon: BookOpen,
    sections: [
      {
        title: 'Master',
        items: [
          { id: 'accounts', label: 'Chart of Accounts', to: '/accounts' },
          { id: 'cost-centres', label: 'Cost Centres', to: '/cost-centres' },
          { id: 'voucher-types', label: 'Voucher Types', to: '/voucher-types' },
        ],
      },
      {
        title: 'Journals',
        items: [
          { id: 'journals', label: 'Journal Entries', to: '/journals' },
          { id: 'recurring-journals', label: 'Recurring Journals', to: '/journals/recurring' },
          { id: 'closing-entries', label: 'Closing Entries', to: '/journals/closing-entries' },
        ],
      },
    ],
  },
  {
    label: 'Transactions',
    icon: ArrowLeftRight,
    sections: [
      {
        title: 'Vouchers',
        items: [
          { id: 'v-payment', label: 'Payment', to: '/vouchers/payment', keycap: 'F5' },
          { id: 'v-receipt', label: 'Receipt', to: '/vouchers/receipt', keycap: 'F6' },
          { id: 'v-contra', label: 'Contra', to: '/vouchers/contra', keycap: 'F4' },
          { id: 'v-journal', label: 'Journal', to: '/vouchers/journal', keycap: 'F7' },
          { id: 'v-sales', label: 'Sales', to: '/vouchers/sales', keycap: 'F8' },
          { id: 'v-purchase', label: 'Purchase', to: '/vouchers/purchase', keycap: 'F9' },
          { id: 'v-credit-note', label: 'Credit Note', to: '/vouchers/credit-note', keycap: 'Ctrl+F8' },
          { id: 'v-debit-note', label: 'Debit Note', to: '/vouchers/debit-note', keycap: 'Ctrl+F9' },
        ],
      },
      {
        title: 'Records',
        items: [
          { id: 'bills', label: 'Bills', to: '/bills' },
          { id: 'recurring-bills', label: 'Recurring Bills', to: '/bills/recurring' },
          { id: 'expenses', label: 'Expenses', to: '/expenses' },
        ],
      },
      {
        title: 'Outstanding',
        items: [
          { id: 'receivables', label: 'Receivables', to: '/receivables' },
          { id: 'payables', label: 'Payables', to: '/payables' },
        ],
      },
    ],
  },
  {
    label: 'Parties',
    icon: Users,
    sections: [
      {
        items: [
          { id: 'suppliers', label: 'Suppliers', to: '/parties/suppliers' },
          { id: 'customers', label: 'Customers', to: '/parties/customers' },
        ],
      },
    ],
  },
  {
    label: 'Banking',
    icon: Landmark,
    sections: [
      {
        title: 'Banking',
        items: [
          { id: 'banking', label: 'Bank Accounts', to: '/banking' },
          { id: 'cheques', label: 'Cheques', to: '/banking/cheques' },
          { id: 'petty-cash', label: 'Petty Cash', to: '/banking/petty-cash' },
        ],
      },
      {
        title: 'Assets',
        items: [
          { id: 'fixed-assets', label: 'Fixed Assets', to: '/fixed-assets' },
          { id: 'loans', label: 'Loans & EMI', to: '/loans' },
        ],
      },
    ],
  },
  {
    label: 'Tax',
    icon: Receipt,
    sections: [
      {
        title: 'GST',
        items: [
          { id: 'gstr1', label: 'GSTR-1', to: '/gst/gstr1' },
          { id: 'gstr2b', label: 'GSTR-2B', to: '/gst/gstr2b' },
          { id: 'gstr3b', label: 'GSTR-3B', to: '/gst/gstr3b' },
          { id: 'gst-b2b', label: 'B2B Register', to: '/gst/b2b-register' },
          { id: 'gst-b2c', label: 'B2C Summary', to: '/gst/b2c-summary' },
          { id: 'gst-cn', label: 'Credit Note Register', to: '/gst/credit-notes' },
          { id: 'gst-grand', label: 'GST Grand Summary', to: '/gst/grand-summary' },
          { id: 'itc', label: 'ITC Reconciliation', to: '/gst/itc-reconciliation' },
          { id: 'gst-comp', label: 'GST Computation', to: '/reports/gst-computation' },
          { id: 'hsn', label: 'HSN Summary', to: '/reports/hsn-summary' },
          { id: 'filing-health', label: 'Filing Health Check', to: '/gst/filing-health' },
        ],
      },
      {
        title: 'Other',
        items: [
          { id: 'tds', label: 'TDS', to: '/tds' },
          { id: 'payroll', label: 'Payroll', to: '/payroll' },
        ],
      },
    ],
  },
  {
    label: 'Reports',
    icon: FileBarChart,
    sections: [
      {
        title: 'Financial',
        items: [
          { id: 'trial', label: 'Trial Balance', to: '/reports/trial-balance' },
          { id: 'pl', label: 'Profit & Loss', to: '/reports/profit-loss' },
          { id: 'bs', label: 'Balance Sheet', to: '/reports/balance-sheet' },
        ],
      },
      {
        title: 'Operational',
        items: [
          { id: 'party', label: 'Party Outstanding', to: '/reports/party-outstanding' },
          { id: 'purchase-reg', label: 'Purchase Register', to: '/reports/purchase-register' },
          { id: 'expense-reg', label: 'Expense Register', to: '/reports/expense-register' },
          { id: 'asset-reg', label: 'Asset Register', to: '/reports/asset-register' },
          { id: 'bank', label: 'Bank Book', to: '/reports/bank-book' },
          { id: 'cash', label: 'Cash Book', to: '/reports/cash-book' },
          { id: 'daybook', label: 'Daybook', to: '/reports/daybook' },
          { id: 'stock', label: 'Stock Summary', to: '/reports/stock-summary' },
        ],
      },
      {
        title: 'Admin',
        items: [
          { id: 'setup', label: 'Setup Checklist', to: '/setup' },
          { id: 'activity-map', label: 'Activity → Account Map', to: '/activity-map' },
          { id: 'sync', label: 'Sync', to: '/sync' },
          { id: 'audit', label: 'Audit Log', to: '/audit' },
          { id: 'settings', label: 'Settings', to: '/settings' },
        ],
      },
    ],
  },
]

/** Flatten a group's sections into a single items array. */
function allItems(g: MenuGroup): MenuItem[] {
  return g.sections.flatMap((s) => s.items)
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
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

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
        onClick={() => setOpen(!open)}
        // py-1 is a touch-target bump; lg keeps the original 2px so the
        // desktop bar is unchanged.
        className="flex items-center gap-1 max-w-full px-2 py-1 lg:py-0.5 rounded-md text-xs font-medium hover:bg-[var(--color-hover-bg)]"
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
              onClick={() => {
                setActiveLocation(null)
                setOpen(false)
              }}
              className="w-full text-left px-4 py-2 text-sm flex items-center justify-between hover:translate-x-0.5 transition-transform"
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
              onClick={() => {
                setActiveLocation(loc.id)
                setOpen(false)
              }}
              className="w-full text-left px-4 py-2 text-sm flex items-center justify-between hover:translate-x-0.5 transition-transform"
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
  activeItemId,
}: {
  open: boolean
  onClose: () => void
  activeItemId: string | null
}) {
  const { theme, setTheme } = useTheme()
  const navigate = useNavigate()
  const activeGroup = useMemo(
    () => menuGroups.find((g) => allItems(g).some((i) => i.id === activeItemId))?.label ?? null,
    [activeItemId]
  )
  const [expanded, setExpanded] = useState<string | null>(activeGroup)

  // Re-sync the open section whenever the drawer is reopened on a new page.
  useEffect(() => {
    if (open) setExpanded(activeGroup)
  }, [open, activeGroup])

  // Hold the page still behind the drawer, and close on Escape.
  useEffect(() => {
    if (!open) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.body.style.overflow = prevOverflow
      document.removeEventListener('keydown', handleEscape)
    }
  }, [open, onClose])

  if (!open) return null

  function handleLogout() {
    localStorage.removeItem('token')
    localStorage.removeItem('refresh_token')
    onClose()
    navigate('/login')
  }

  return (
    <div className="lg:hidden">
      <div
        className="fixed inset-0 z-50 bg-black/40 animate-fade-in"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Main menu"
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
            className="w-9 h-9 -mr-2 rounded-md flex items-center justify-center hover:bg-[var(--color-hover-bg)]"
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
                  className="w-full flex items-center gap-3 px-4 h-11 text-sm font-medium"
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
            className="w-full flex items-center gap-3 px-2 h-11 rounded-md text-sm hover:bg-[var(--color-hover-bg)]"
            style={{ color: 'var(--ink-2)' }}
          >
            {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            {theme === 'dark' ? 'Light mode' : 'Dark mode'}
          </button>
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-2 h-11 rounded-md text-sm hover:bg-[var(--color-hover-bg)]"
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
  const navRef = useRef<HTMLElement>(null)
  const activeItemId = useMemo(() => findActiveItemId(routerLoc.pathname), [routerLoc.pathname])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (navRef.current && !navRef.current.contains(e.target as Node)) {
        setOpenMenu(null)
        setShowProfile(false)
      }
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpenMenu(null)
        setShowProfile(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [])

  function handleLogout() {
    localStorage.removeItem('token')
    localStorage.removeItem('refresh_token')
    navigate('/login')
  }

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
        onClick={() => setDrawerOpen(true)}
        className="lg:hidden w-9 h-9 -ml-1 rounded-md flex items-center justify-center flex-shrink-0 hover:bg-[var(--color-hover-bg)]"
        style={{ color: 'var(--ink-2)' }}
        aria-label="Open menu"
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
        {menuGroups.map((group) => {
          const active = isGroupActive(group)
          const isOpen = openMenu === group.label
          const hasSubs = allItems(group).length > 1
          const Icon = group.icon

          return (
            <div key={group.label} className="relative flex-1 min-w-0 flex justify-center">
              <button
                onClick={() => handleGroupClick(group)}
                className={cn(
                  'relative flex items-center justify-center gap-1 px-2 py-2 rounded-md text-sm font-medium w-full max-w-[150px] min-w-0',
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
                        return (
                          <NavLink
                            key={item.id}
                            to={item.to}
                            end={item.to === '/'}
                            onClick={() => setOpenMenu(null)}
                            className={cn(
                              'flex items-center justify-between w-full text-left px-4 py-2 text-sm hover:translate-x-0.5 transition-transform',
                              itemActive && 'font-medium'
                            )}
                            style={
                              itemActive
                                ? { color: 'var(--brand)', backgroundColor: 'rgba(15, 157, 154, 0.08)' }
                                : { color: 'var(--ink)' }
                            }
                          >
                            <span className="truncate">{item.label}</span>
                            {item.keycap && (
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
                                {item.keycap}
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
          className="hidden sm:block p-2 rounded-md hover:bg-[var(--color-hover-bg)]"
          style={{ color: 'var(--ink-2)' }}
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>

        <div className="relative">
          <button
            onClick={() => {
              setShowProfile(!showProfile)
              setOpenMenu(null)
            }}
            className="flex items-center gap-2 p-1 rounded-md hover:bg-[var(--color-hover-bg)]"
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
                  onClick={handleLogout}
                  className="w-full px-4 py-2.5 text-left text-sm flex items-center gap-3 hover:translate-x-0.5 transition-transform"
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
      activeItemId={activeItemId}
    />
    </>
  )
}

function GlobalNavShortcuts() {
  const navigate = useNavigate()
  const handlers = useMemo<HotkeyHandler[]>(() => [
    { chord: 'F4', preventDefault: true, handler: () => navigate('/vouchers/contra') },
    { chord: 'F5', preventDefault: true, handler: () => navigate('/vouchers/payment') },
    { chord: 'F6', preventDefault: true, handler: () => navigate('/vouchers/receipt') },
    { chord: 'F7', preventDefault: true, handler: () => navigate('/vouchers/journal') },
    { chord: 'F8', preventDefault: true, handler: () => navigate('/vouchers/sales') },
    { chord: 'F9', preventDefault: true, handler: () => navigate('/vouchers/purchase') },
    { chord: 'Ctrl+F8', preventDefault: true, handler: () => navigate('/vouchers/credit-note') },
    { chord: 'Ctrl+F9', preventDefault: true, handler: () => navigate('/vouchers/debit-note') },
    { chord: 'F11', preventDefault: true, handler: () => navigate('/setup') },
  ], [navigate])
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
  return (
    <HotkeyProvider>
      <div className="min-h-screen" style={{ backgroundColor: 'var(--surface-1)' }}>
        <TopNav />
        <GlobalNavShortcuts />
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
        <HotkeyBar />
        <CommandPalette />
      </div>
    </HotkeyProvider>
  )
}
