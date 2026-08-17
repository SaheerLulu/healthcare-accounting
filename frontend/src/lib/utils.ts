import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(amount: string | number): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount
  if (isNaN(num)) return '₹0.00'
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
  }).format(num)
}

export function formatDate(date: string): string {
  if (!date) return '-'
  return new Date(date).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/**
 * Today in the BROWSER's timezone as YYYY-MM-DD.
 *
 * `new Date().toISOString().slice(0, 10)` is the UTC date, which in IST
 * (UTC+5:30) is YESTERDAY every day between midnight and 05:30 local — an
 * "as of" filter or a voucher date seeded that way silently backdates.
 */
export function todayISO(): string {
  const now = new Date()
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`
}

/**
 * The financial year containing today, for a tenant whose FY starts in
 * `fyStartMonth` (1-12).
 *
 * The default of 4 (April) matches ACCOUNTING_FY_START_MONTH on the backend,
 * but a tenant can override it via AccountingSettings.financial_year_start —
 * so callers that have the configured month in hand must pass it rather than
 * inherit the Indian statutory default.
 */
export function getCurrentFY(fyStartMonth: number = 4): { start: string; end: string } {
  const now = new Date()
  const raw = Math.trunc(Number(fyStartMonth))
  const startMonth = Number.isFinite(raw) && raw >= 1 && raw <= 12 ? raw : 4
  // getMonth() is 0-based; fyStartMonth is 1-based.
  const startYear = now.getMonth() + 1 >= startMonth ? now.getFullYear() : now.getFullYear() - 1
  const endMonth = startMonth === 1 ? 12 : startMonth - 1
  const endYear = startMonth === 1 ? startYear : startYear + 1
  // Day 0 of month N+1 is the last day of month N (endMonth is already 1-based,
  // so this is "day 0 of the month after endMonth") — leap-safe, so a January
  // FY start ends on 31 Dec and a March start ends on 29 Feb in a leap year.
  const lastDay = new Date(endYear, endMonth, 0).getDate()
  return {
    start: `${startYear}-${pad2(startMonth)}-01`,
    end: `${endYear}-${pad2(endMonth)}-${pad2(lastDay)}`,
  }
}

export function getCurrentPeriod(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}
