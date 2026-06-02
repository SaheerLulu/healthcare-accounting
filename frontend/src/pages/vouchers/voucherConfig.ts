import type { Account } from '../../lib/api'

export type VoucherType =
  | 'PAYMENT'
  | 'RECEIPT'
  | 'CONTRA'
  | 'JOURNAL'
  | 'SALE'
  | 'PURCHASE'
  | 'CREDIT_NOTE'
  | 'DEBIT_NOTE'

export type LineSide = 'Dr' | 'Cr'

export type PartyType = 'Supplier' | 'Customer' | null

/**
 * Per-voucher-type defaults that shape the editor.
 *
 * `accountFilter` is invoked on each line to limit which accounts the picker
 * shows. Lines have a `side` (Dr/Cr); the editor consults `accountFilter` with
 * the side so that, e.g., on a Payment voucher the Cr line is restricted to
 * Bank/Cash subtypes while the Dr line is open to any expense/payable.
 */
export interface VoucherConfig {
  type: VoucherType
  label: string
  fKey: string
  routePath: string
  description: string
  partyType: PartyType
  firstLineSide: LineSide
  secondLineSide: LineSide
  narrationTemplate: string
  /** Per-side account filter; returns true if the account is eligible. */
  accountFilter: (account: Account, side: LineSide) => boolean
}

const isBankOrCash = (a: Account) =>
  a.account_subtype === 'Bank' || a.account_subtype === 'Cash'

const isPayable = (a: Account) => a.account_subtype === 'Payable'
const isReceivable = (a: Account) => a.account_subtype === 'Receivable'

const isSalesAccount = (a: Account) =>
  a.account_type === 'REVENUE' &&
  (a.account_subtype === 'Sales' || a.account_subtype === 'Other_Income')

const isPurchaseAccount = (a: Account) =>
  a.account_type === 'EXPENSE' &&
  (a.account_subtype === 'Purchases' ||
    a.account_subtype === 'Other_Expense')

/** Account is "leaf-eligible" — active, leaf, ready for posting. */
function isPostable(a: Account): boolean {
  if (a.is_active === false) return false
  if (a.children && a.children.length > 0 && !a.is_leaf) return false
  return true
}

const allLeaves = (a: Account, _side: LineSide) => isPostable(a)

export const voucherConfigs: Record<VoucherType, VoucherConfig> = {
  PAYMENT: {
    type: 'PAYMENT',
    label: 'Payment',
    fKey: 'F5',
    routePath: '/vouchers/payment',
    description: 'Cash & bank outflows',
    partyType: 'Supplier',
    firstLineSide: 'Dr',
    secondLineSide: 'Cr',
    narrationTemplate: 'Being payment to ',
    accountFilter: (a, side) => {
      if (!isPostable(a)) return false
      if (side === 'Cr') return isBankOrCash(a)
      // Dr side — payables, expenses, or any other valid Dr.
      return isPayable(a) || a.account_type === 'EXPENSE' || a.account_type === 'ASSET'
    },
  },
  RECEIPT: {
    type: 'RECEIPT',
    label: 'Receipt',
    fKey: 'F6',
    routePath: '/vouchers/receipt',
    description: 'Cash & bank inflows',
    partyType: 'Customer',
    firstLineSide: 'Dr',
    secondLineSide: 'Cr',
    narrationTemplate: 'Being receipt from ',
    accountFilter: (a, side) => {
      if (!isPostable(a)) return false
      if (side === 'Dr') return isBankOrCash(a)
      // Cr — receivables, revenues.
      return isReceivable(a) || a.account_type === 'REVENUE' || a.account_type === 'LIABILITY'
    },
  },
  CONTRA: {
    type: 'CONTRA',
    label: 'Contra',
    fKey: 'F4',
    routePath: '/vouchers/contra',
    description: 'Bank ↔ cash transfers',
    partyType: null,
    firstLineSide: 'Dr',
    secondLineSide: 'Cr',
    narrationTemplate: 'Being transfer between bank and cash',
    accountFilter: (a, _side) => isPostable(a) && isBankOrCash(a),
  },
  JOURNAL: {
    type: 'JOURNAL',
    label: 'Journal',
    fKey: 'F7',
    routePath: '/vouchers/journal',
    description: 'Free-form double-entry',
    partyType: null,
    firstLineSide: 'Dr',
    secondLineSide: 'Cr',
    narrationTemplate: '',
    accountFilter: allLeaves,
  },
  SALE: {
    type: 'SALE',
    label: 'Sales',
    fKey: 'F8',
    routePath: '/vouchers/sales',
    description: 'Sales invoices',
    partyType: 'Customer',
    firstLineSide: 'Dr',
    secondLineSide: 'Cr',
    narrationTemplate: 'Being sale to ',
    accountFilter: (a, side) => {
      if (!isPostable(a)) return false
      if (side === 'Dr') return isReceivable(a) || isBankOrCash(a)
      return isSalesAccount(a) || a.account_subtype === 'Output_GST' || a.account_type === 'REVENUE'
    },
  },
  PURCHASE: {
    type: 'PURCHASE',
    label: 'Purchase',
    fKey: 'F9',
    routePath: '/vouchers/purchase',
    description: 'Purchase invoices',
    partyType: 'Supplier',
    firstLineSide: 'Dr',
    secondLineSide: 'Cr',
    narrationTemplate: 'Being purchase from ',
    accountFilter: (a, side) => {
      if (!isPostable(a)) return false
      if (side === 'Dr') return isPurchaseAccount(a) || a.account_subtype === 'Input_GST' || a.account_type === 'EXPENSE'
      return isPayable(a) || isBankOrCash(a)
    },
  },
  CREDIT_NOTE: {
    type: 'CREDIT_NOTE',
    label: 'Credit Note',
    fKey: 'Ctrl+F8',
    routePath: '/vouchers/credit-note',
    description: 'Sales returns / customer credits',
    partyType: 'Customer',
    firstLineSide: 'Dr',
    secondLineSide: 'Cr',
    narrationTemplate: 'Being credit note to ',
    accountFilter: (a, side) => {
      if (!isPostable(a)) return false
      // Dr side reverses sales AND the output GST charged on the original invoice.
      if (side === 'Dr') return a.account_subtype === 'Sales' || a.account_subtype === 'Output_GST' || a.account_type === 'REVENUE' || a.account_type === 'EXPENSE'
      return isReceivable(a) || isBankOrCash(a)
    },
  },
  DEBIT_NOTE: {
    type: 'DEBIT_NOTE',
    label: 'Debit Note',
    fKey: 'Ctrl+F9',
    routePath: '/vouchers/debit-note',
    description: 'Purchase returns / supplier debits',
    partyType: 'Supplier',
    firstLineSide: 'Dr',
    secondLineSide: 'Cr',
    narrationTemplate: 'Being debit note to ',
    accountFilter: (a, side) => {
      if (!isPostable(a)) return false
      if (side === 'Dr') return isPayable(a) || isBankOrCash(a)
      // Cr side reverses purchases AND the input GST claimed on the original bill.
      return a.account_subtype === 'Purchases' || a.account_subtype === 'Input_GST' || a.account_type === 'EXPENSE' || a.account_type === 'REVENUE'
    },
  },
}

export const voucherList: VoucherConfig[] = [
  voucherConfigs.CONTRA,
  voucherConfigs.PAYMENT,
  voucherConfigs.RECEIPT,
  voucherConfigs.JOURNAL,
  voucherConfigs.SALE,
  voucherConfigs.PURCHASE,
  voucherConfigs.CREDIT_NOTE,
  voucherConfigs.DEBIT_NOTE,
]
