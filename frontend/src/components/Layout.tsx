import { NavLink, Outlet, useNavigate, useLocation as useRouterLocation } from 'react-router-dom'
import { useState, useRef, useEffect, useMemo } from 'react'
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
    <div className="relative flex-shrink-0" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium hover:bg-[var(--color-hover-bg)]"
        style={{
          color: 'var(--ink)',
          border: '1px solid var(--line)',
          background: 'var(--surface-0)',
        }}
      >
        <MapPin className="w-3 h-3 flex-shrink-0" style={{ color: 'var(--brand)' }} />
        <span className="max-w-[110px] truncate">{label}</span>
        <ChevronDown className={cn('w-3 h-3 flex-shrink-0 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div
          className="absolute top-full left-0 mt-1 rounded-lg shadow-lg py-1 min-w-[220px] z-50 dropdown-animate"
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
    <nav
      ref={navRef}
      className="h-16 backdrop-blur-lg border-b fixed top-0 left-0 right-0 z-40 flex items-center px-3 gap-1"
      style={{ backgroundColor: 'var(--color-nav-bg)', borderColor: 'var(--color-nav-border)' }}
    >
      {/* Brand + store selector stacked: logo on top, store selector beneath it. */}
      <div className="flex flex-col justify-center items-start gap-1 mr-3 flex-shrink-0">
        <Wordmark />
        <LocationSelector />
      </div>

      {/* Menu Groups — flex-1 children with min-w-0 so they shrink and labels
          truncate instead of overflowing the bar on narrow / 100%-zoom screens. */}
      <div className="flex items-center flex-1 min-w-0 gap-0.5">
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
                <span className="hidden md:inline truncate">{group.label}</span>
                {hasSubs && (
                  <ChevronDown
                    className={cn('w-3 h-3 flex-shrink-0 transition-transform', isOpen && 'rotate-180')}
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
      <div className="flex items-center gap-2 flex-shrink-0">
        <NotificationBell />
        <button
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          className="p-2 rounded-md hover:bg-[var(--color-hover-bg)]"
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

export default function Layout() {
  const { activeLocationId } = useAppLocation()
  return (
    <HotkeyProvider>
      <div className="min-h-screen" style={{ backgroundColor: 'var(--surface-1)' }}>
        <TopNav />
        <GlobalNavShortcuts />
        <main className="px-6 pb-14 pt-20">
          {/* Keyed by store: switching the store remounts the routed page so
              every screen refetches with the new X-Location-Id. */}
          <PageTransition key={activeLocationId ?? 'all'}>
            <Outlet />
          </PageTransition>
        </main>
        <HotkeyBar />
        <CommandPalette />
      </div>
    </HotkeyProvider>
  )
}
