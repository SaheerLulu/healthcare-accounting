import type * as React from 'react'
import {
  ArrowLeftRight, BookOpen, FileBarChart, Home, Landmark, LayoutDashboard,
  Receipt, Users,
} from 'lucide-react'

/**
 * The application's navigation tree — the single list of every screen a user
 * can reach.
 *
 * Lifted out of Layout so the command palette can be BUILT from it rather than
 * repeating it. The palette is the primary way a keyboard-only user moves
 * around, and a hand-kept copy of this list would quietly fall behind every
 * time a screen was added: the page would exist, appear in the menus, and be
 * unreachable from Ctrl+K. Deriving it means that cannot happen.
 *
 * Layout renders it as menus; lib/navigation's `navDestinations()` flattens it
 * for search. Nothing else should hold a second list of routes.
 */

export interface MenuItem {
  id: string
  label: string
  to: string
  keycap?: string
}

export interface MenuSection {
  /** Section header inside a dropdown; omit for "ungrouped" sections. */
  title?: string
  items: MenuItem[]
}

export interface MenuGroup {
  label: string
  icon: React.ComponentType<{ className?: string }>
  sections: MenuSection[]
}

// Reduced from 10 to 8 top-level entries (2 standalone + 6 grouped) by
// merging Ledger/Bills/Vouchers into Books+Transactions, Banking+Assets,
// GST+TDS+Payroll into Tax & Compliance, and dissolving the "More" bucket
// into Reports & Admin. Each long dropdown is split into named sections
// so a 14-item menu reads as 3 mini-groups instead of a wall of text.
export const menuGroups: MenuGroup[] = [
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

/** Every navigable screen, flattened, with the menu path that leads to it. */
export function navDestinations(): Array<MenuItem & { group: string; section?: string }> {
  return menuGroups.flatMap((g) =>
    g.sections.flatMap((s) =>
      s.items.map((it) => ({ ...it, group: g.label, section: s.title })),
    ),
  )
}

/** Flatten one group's sections into a single items array. */
export function allItems(g: MenuGroup): MenuItem[] {
  return g.sections.flatMap((s) => s.items)
}
