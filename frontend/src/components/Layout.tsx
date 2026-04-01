import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useState, useRef, useEffect } from 'react'
import {
  LayoutDashboard,
  BookOpen,
  FileText,
  TrendingUp,
  TrendingDown,
  RefreshCw,
  Settings,
  LogOut,
  Receipt,
  FileBarChart,
  Scale,
  ChevronRight,
  Building2,
  ClipboardList,
  MapPin,
  ChevronDown,
  Check,
  Globe,
} from 'lucide-react'
import { cn } from '../lib/utils'
import { ThemeToggle } from './ui/theme-toggle'
import { useLocation } from '../contexts/LocationContext'

interface NavItem {
  label: string
  to?: string
  icon?: React.ReactNode
  separator?: string
  children?: NavItem[]
}

const navItems: NavItem[] = [
  { label: 'Dashboard', to: '/dashboard', icon: <LayoutDashboard size={16} /> },
  { label: 'Chart of Accounts', to: '/accounts', icon: <BookOpen size={16} /> },
  { label: 'Journal Entries', to: '/journals', icon: <FileText size={16} /> },
  { label: 'Receivables', to: '/receivables', icon: <TrendingUp size={16} /> },
  { label: 'Payables', to: '/payables', icon: <TrendingDown size={16} /> },
  {
    label: 'GST Filing',
    separator: 'GST Filing',
    icon: <Receipt size={16} />,
    children: [
      { label: 'GSTR-1', to: '/gst/gstr1' },
      { label: 'GSTR-2B', to: '/gst/gstr2b' },
      { label: 'GSTR-3B', to: '/gst/gstr3b' },
      { label: 'ITC Reconciliation', to: '/gst/itc-reconciliation' },
    ],
  },
  { label: 'TDS', to: '/tds', icon: <FileBarChart size={16} />, separator: 'Tax' },
  { label: 'Payroll', to: '/payroll', icon: <Receipt size={16} /> },
  {
    label: 'Reports',
    separator: 'Reports',
    icon: <Scale size={16} />,
    children: [
      { label: 'Trial Balance', to: '/reports/trial-balance' },
      { label: 'Profit & Loss', to: '/reports/profit-loss' },
      { label: 'Balance Sheet', to: '/reports/balance-sheet' },
      { label: 'GST Computation', to: '/reports/gst-computation' },
      { label: 'HSN Summary', to: '/reports/hsn-summary' },
      { label: 'Party Outstanding', to: '/reports/party-outstanding' },
      { label: 'Bank Book', to: '/reports/bank-book' },
      { label: 'Cash Book', to: '/reports/cash-book' },
      { label: 'Daybook', to: '/reports/daybook' },
      { label: 'Stock Summary', to: '/reports/stock-summary' },
    ],
  },
  { label: 'Sync', to: '/sync', icon: <RefreshCw size={16} /> },
  { label: 'Audit Log', to: '/audit', icon: <ClipboardList size={16} /> },
  { label: 'Settings', to: '/settings', icon: <Settings size={16} /> },
]

function SidebarLink({ to, icon, label }: { to: string; icon?: React.ReactNode; label: string }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-colors',
          isActive
            ? 'bg-teal-500/10 text-teal-300'
            : 'text-slate-400 hover:text-white hover:bg-white/5'
        )
      }
    >
      {icon && <span className="shrink-0">{icon}</span>}
      <span>{label}</span>
    </NavLink>
  )
}

function SidebarSection({ item }: { item: NavItem }) {
  if (item.children) {
    return (
      <div>
        {item.separator && (
          <p className="px-3 pt-4 pb-1 text-xs font-semibold uppercase tracking-wider text-slate-400">
            {item.separator}
          </p>
        )}
        <div className="flex flex-col gap-0.5">
          {item.children.map((child) => (
            <NavLink
              key={child.to}
              to={child.to!}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2.5 pl-6 pr-3 py-2 rounded-md text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-teal-500/10 text-teal-300'
                    : 'text-slate-400 hover:text-white hover:bg-white/5'
                )
              }
            >
              <ChevronRight size={12} className="shrink-0 text-slate-400" />
              {child.label}
            </NavLink>
          ))}
        </div>
      </div>
    )
  }

  return (
    <>
      {item.separator && (
        <p className="px-3 pt-4 pb-1 text-xs font-semibold uppercase tracking-wider text-slate-400">
          {item.separator}
        </p>
      )}
      <SidebarLink to={item.to!} icon={item.icon} label={item.label} />
    </>
  )
}

function LocationSelector() {
  const { locations, activeLocationId, activeLocation, canSeeAll, isLoading, setActiveLocation } = useLocation()
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
      <div className="px-3 py-2.5 border-b border-slate-800">
        <div className="h-8 rounded-md bg-slate-800 animate-pulse" />
      </div>
    )
  }

  const label = activeLocation ? activeLocation.name : (canSeeAll ? 'All Locations' : 'No Location')

  return (
    <div className="px-3 py-2.5 border-b border-slate-800" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-sm font-medium text-slate-300 hover:bg-white/5 transition-colors"
      >
        <MapPin size={14} className="shrink-0 text-teal-400" />
        <span className="flex-1 text-left truncate">{label}</span>
        <ChevronDown size={14} className={cn('shrink-0 text-slate-500 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="mt-1 rounded-md bg-slate-800 border border-slate-700 py-1 max-h-52 overflow-y-auto">
          {canSeeAll && (
            <button
              onClick={() => { setActiveLocation(null); setOpen(false) }}
              className={cn(
                'w-full flex items-center gap-2 px-3 py-1.5 text-sm transition-colors',
                activeLocationId === null ? 'text-teal-300 bg-teal-500/10' : 'text-slate-400 hover:text-white hover:bg-white/5'
              )}
            >
              <Globe size={13} className="shrink-0" />
              <span className="flex-1 text-left">All Locations</span>
              {activeLocationId === null && <Check size={13} className="shrink-0" />}
            </button>
          )}
          {locations.map((loc) => (
            <button
              key={loc.id}
              onClick={() => { setActiveLocation(loc.id); setOpen(false) }}
              className={cn(
                'w-full flex items-center gap-2 px-3 py-1.5 text-sm transition-colors',
                activeLocationId === loc.id ? 'text-teal-300 bg-teal-500/10' : 'text-slate-400 hover:text-white hover:bg-white/5'
              )}
            >
              <MapPin size={13} className="shrink-0" />
              <span className="flex-1 text-left truncate">{loc.name}</span>
              {activeLocationId === loc.id && <Check size={13} className="shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function Layout() {
  const navigate = useNavigate()

  function handleLogout() {
    localStorage.removeItem('token')
    localStorage.removeItem('refresh_token')
    navigate('/login')
  }

  return (
    <div className="flex h-screen bg-slate-50">
      {/* Sidebar */}
      <aside className="w-56 shrink-0 flex flex-col bg-slate-900 border-r border-slate-800">
        {/* Logo */}
        <div className="flex items-center gap-2.5 px-4 py-5 border-b border-slate-800">
          <div className="w-7 h-7 rounded-md bg-teal-600 flex items-center justify-center shrink-0">
            <Building2 size={14} className="text-white" />
          </div>
          <div>
            <p className="text-sm font-semibold text-white leading-none">Seefmed</p>
            <p className="text-xs text-slate-400 leading-none mt-0.5">Accounting</p>
          </div>
        </div>

        {/* Location Selector */}
        <LocationSelector />

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-0.5">
          {navItems.map((item, i) => (
            <SidebarSection key={i} item={item} />
          ))}
        </nav>

        {/* Footer */}
        <div className="px-3 py-3 border-t border-slate-800 flex items-center gap-2">
          <button
            onClick={handleLogout}
            className="flex-1 flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
          >
            <LogOut size={16} />
            <span>Logout</span>
          </button>
          <ThemeToggle />
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  )
}
