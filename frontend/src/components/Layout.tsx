import { NavLink, Outlet, useNavigate, useLocation as useRouterLocation } from 'react-router-dom'
import { useState, useRef, useEffect } from 'react'
import {
  LayoutDashboard,
  BookOpen,
  Receipt,
  FileBarChart,
  Scale,
  Ellipsis,
  ChevronDown,
  MapPin,
  Check,
  User,
  LogOut,
  Sun,
  Moon,
  Calculator,
  Globe,
} from 'lucide-react'
import { useTheme } from 'next-themes'
import { cn } from '../lib/utils'
import { useLocation as useAppLocation } from '../contexts/LocationContext'

interface MenuItem {
  id: string
  label: string
  to: string
}

interface MenuGroup {
  label: string
  icon: React.ComponentType<{ className?: string }>
  items: MenuItem[]
}

const menuGroups: MenuGroup[] = [
  {
    label: 'Dashboard',
    icon: LayoutDashboard,
    items: [{ id: 'dashboard', label: 'Dashboard', to: '/dashboard' }],
  },
  {
    label: 'Ledger',
    icon: BookOpen,
    items: [
      { id: 'accounts', label: 'Chart of Accounts', to: '/accounts' },
      { id: 'journals', label: 'Journal Entries', to: '/journals' },
      { id: 'receivables', label: 'Receivables', to: '/receivables' },
      { id: 'payables', label: 'Payables', to: '/payables' },
    ],
  },
  {
    label: 'GST',
    icon: Receipt,
    items: [
      { id: 'gstr1', label: 'GSTR-1', to: '/gst/gstr1' },
      { id: 'gstr2b', label: 'GSTR-2B', to: '/gst/gstr2b' },
      { id: 'gstr3b', label: 'GSTR-3B', to: '/gst/gstr3b' },
      { id: 'itc', label: 'ITC Reconciliation', to: '/gst/itc-reconciliation' },
    ],
  },
  {
    label: 'Tax & Payroll',
    icon: FileBarChart,
    items: [
      { id: 'tds', label: 'TDS', to: '/tds' },
      { id: 'payroll', label: 'Payroll', to: '/payroll' },
    ],
  },
  {
    label: 'Reports',
    icon: Scale,
    items: [
      { id: 'trial', label: 'Trial Balance', to: '/reports/trial-balance' },
      { id: 'pl', label: 'Profit & Loss', to: '/reports/profit-loss' },
      { id: 'bs', label: 'Balance Sheet', to: '/reports/balance-sheet' },
      { id: 'gst-comp', label: 'GST Computation', to: '/reports/gst-computation' },
      { id: 'hsn', label: 'HSN Summary', to: '/reports/hsn-summary' },
      { id: 'party', label: 'Party Outstanding', to: '/reports/party-outstanding' },
      { id: 'bank', label: 'Bank Book', to: '/reports/bank-book' },
      { id: 'cash', label: 'Cash Book', to: '/reports/cash-book' },
      { id: 'daybook', label: 'Daybook', to: '/reports/daybook' },
      { id: 'stock', label: 'Stock Summary', to: '/reports/stock-summary' },
    ],
  },
  {
    label: 'More',
    icon: Ellipsis,
    items: [
      { id: 'sync', label: 'Sync', to: '/sync' },
      { id: 'audit', label: 'Audit Log', to: '/audit' },
      { id: 'settings', label: 'Settings', to: '/settings' },
    ],
  },
]

function LocationSelector() {
  const { locations, activeLocationId, activeLocation, canSeeAll, isLoading, setActiveLocation } = useAppLocation()
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
    return <div className="h-8 w-32 rounded-lg animate-pulse" style={{ backgroundColor: 'var(--color-hover-bg)' }} />
  }

  const label = activeLocation ? activeLocation.name : canSeeAll ? 'All Locations' : 'No Location'

  return (
    <div className="relative flex-shrink-0" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors hover:bg-gray-100 border"
        style={{ color: 'var(--color-slate)', borderColor: 'var(--color-card-border)' }}
      >
        <MapPin className="w-3.5 h-3.5" style={{ color: 'var(--color-teal)' }} />
        <span className="max-w-[140px] truncate">{label}</span>
        <ChevronDown className={cn('w-3 h-3 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div
          className="absolute top-full left-0 mt-1 rounded-lg shadow-lg py-1 min-w-[200px] z-50 dropdown-animate border"
          style={{ backgroundColor: 'var(--color-dropdown-bg)', borderColor: 'var(--color-card-border)' }}
        >
          <div className="px-3 py-2 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>
            Switch Location
          </div>
          {canSeeAll && (
            <button
              onClick={() => { setActiveLocation(null); setOpen(false) }}
              className="w-full text-left px-4 py-2 text-sm flex items-center justify-between transition-all hover:translate-x-0.5"
              style={
                activeLocationId === null
                  ? { color: 'var(--color-teal)', backgroundColor: 'rgba(15, 157, 154, 0.08)', fontWeight: 500 }
                  : { color: 'var(--color-text-primary)' }
              }
            >
              <span className="flex items-center gap-2"><Globe className="w-4 h-4" /> All Locations</span>
              {activeLocationId === null && <Check className="w-4 h-4" style={{ color: 'var(--color-teal)' }} />}
            </button>
          )}
          {locations.map((loc) => (
            <button
              key={loc.id}
              onClick={() => { setActiveLocation(loc.id); setOpen(false) }}
              className="w-full text-left px-4 py-2 text-sm flex items-center justify-between transition-all hover:translate-x-0.5"
              style={
                activeLocationId === loc.id
                  ? { color: 'var(--color-teal)', backgroundColor: 'rgba(15, 157, 154, 0.08)', fontWeight: 500 }
                  : { color: 'var(--color-text-primary)' }
              }
            >
              <span className="truncate">{loc.name}</span>
              {activeLocationId === loc.id && <Check className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--color-teal)' }} />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function TopNav() {
  const navigate = useNavigate()
  const routerLoc = useRouterLocation()
  const { theme, setTheme } = useTheme()
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const [showProfile, setShowProfile] = useState(false)
  const navRef = useRef<HTMLElement>(null)

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
    return group.items.some((item) => routerLoc.pathname.startsWith(item.to))
  }

  function handleGroupClick(group: MenuGroup) {
    if (group.items.length === 1) {
      navigate(group.items[0].to)
      setOpenMenu(null)
    } else {
      setOpenMenu(openMenu === group.label ? null : group.label)
    }
    setShowProfile(false)
  }

  return (
    <nav
      ref={navRef}
      className="h-16 backdrop-blur-lg border-b fixed top-0 left-0 right-0 z-40 flex items-center px-4"
      style={{ backgroundColor: 'var(--color-nav-bg)', borderColor: 'var(--color-nav-border)' }}
    >
      {/* Logo */}
      <div className="flex items-center gap-2 mr-6 flex-shrink-0">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'var(--color-teal)' }}>
          <Calculator className="w-4 h-4 text-white" />
        </div>
        <div className="leading-tight">
          <p className="font-semibold text-sm" style={{ color: 'var(--color-slate)' }}>Seefmed</p>
          <p className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>Accounting</p>
        </div>
      </div>

      {/* Location Selector */}
      <div className="mr-3"><LocationSelector /></div>

      {/* Menu Groups */}
      <div className="flex items-center flex-1 mx-2">
        {menuGroups.map((group) => {
          const active = isGroupActive(group)
          const isOpen = openMenu === group.label
          const hasSubs = group.items.length > 1
          const Icon = group.icon

          return (
            <div key={group.label} className="relative flex-1 flex justify-center">
              <button
                onClick={() => handleGroupClick(group)}
                className={cn(
                  'relative flex items-center justify-center gap-1 px-3 py-2 rounded-lg text-sm font-medium w-full max-w-[150px]',
                  !active && 'hover:bg-gray-100'
                )}
                style={
                  active
                    ? { color: 'var(--color-teal)', backgroundColor: 'rgba(15, 157, 154, 0.08)' }
                    : { color: 'var(--color-text-secondary)' }
                }
              >
                <Icon className="w-4 h-4" />
                <span className="hidden md:inline">{group.label}</span>
                {hasSubs && <ChevronDown className={cn('w-3 h-3 transition-transform', isOpen && 'rotate-180')} />}
                {active && (
                  <span
                    className="absolute bottom-0 left-1/2 -translate-x-1/2 w-6 h-0.5 rounded-full"
                    style={{ backgroundColor: 'var(--color-teal)' }}
                  />
                )}
              </button>

              {isOpen && hasSubs && (
                <div
                  className="absolute top-full left-1/2 -translate-x-1/2 mt-1 rounded-lg shadow-lg py-1 min-w-[220px] z-50 dropdown-animate border"
                  style={{ backgroundColor: 'var(--color-dropdown-bg)', borderColor: 'var(--color-card-border)' }}
                >
                  {group.items.map((item) => (
                    <NavLink
                      key={item.id}
                      to={item.to}
                      onClick={() => setOpenMenu(null)}
                      className={({ isActive }) =>
                        cn(
                          'block w-full text-left px-4 py-2 text-sm transition-all hover:translate-x-0.5',
                          isActive && 'font-medium'
                        )
                      }
                      style={({ isActive }) =>
                        isActive
                          ? { color: 'var(--color-teal)', backgroundColor: 'rgba(15, 157, 154, 0.08)' }
                          : { color: 'var(--color-text-primary)' }
                      }
                    >
                      {item.label}
                    </NavLink>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Right: Theme + Profile */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <button
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
          style={{ color: 'var(--color-text-secondary)' }}
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
        </button>

        <div className="relative">
          <button
            onClick={() => { setShowProfile(!showProfile); setOpenMenu(null) }}
            className="flex items-center gap-2 p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <div className="w-7 h-7 rounded-full flex items-center justify-center" style={{ backgroundColor: 'var(--color-teal)' }}>
              <User className="w-3.5 h-3.5 text-white" />
            </div>
            <ChevronDown className="w-3.5 h-3.5 hidden lg:block" style={{ color: 'var(--color-text-muted)' }} />
          </button>

          {showProfile && (
            <div
              className="absolute right-0 mt-2 w-56 rounded-xl shadow-xl overflow-hidden z-50 dropdown-animate border"
              style={{ backgroundColor: 'var(--color-dropdown-bg)', borderColor: 'var(--color-card-border)' }}
            >
              <div className="p-4 border-b" style={{ borderColor: 'var(--color-card-border)', backgroundColor: 'var(--color-grey-light)' }}>
                <p className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>Signed in</p>
                <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>Seefmed Accounting</p>
              </div>
              <div className="py-2">
                <button
                  onClick={handleLogout}
                  className="w-full px-4 py-2.5 text-left text-sm flex items-center gap-3 text-red-600 hover:bg-red-50 transition-all hover:translate-x-0.5"
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

export default function Layout() {
  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--color-grey-bg)' }}>
      <TopNav />
      <main className="px-6 pb-6 pt-20 animate-fade-in">
        <Outlet />
      </main>
    </div>
  )
}

