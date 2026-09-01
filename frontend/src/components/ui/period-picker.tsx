import { forwardRef, useMemo } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

const MONTHS = [
  { value: '01', label: 'Jan' },
  { value: '02', label: 'Feb' },
  { value: '03', label: 'Mar' },
  { value: '04', label: 'Apr' },
  { value: '05', label: 'May' },
  { value: '06', label: 'Jun' },
  { value: '07', label: 'Jul' },
  { value: '08', label: 'Aug' },
  { value: '09', label: 'Sep' },
  { value: '10', label: 'Oct' },
  { value: '11', label: 'Nov' },
  { value: '12', label: 'Dec' },
]

interface PeriodPickerProps {
  value: string // YYYY-MM
  onChange: (value: string) => void
  /** Names the pair, e.g. "GSTR-1 period". Falls back to a generic label. */
  label?: string
}

/**
 * Month + year pair producing a YYYY-MM GST period.
 *
 * The forwarded ref lands on the MONTH select — the entry point of the pair —
 * so a report screen can make the period its F2 target (or its
 * `data-autofocus`) instead of leaving the user to Tab-walk the header to
 * change what every figure on the page is computed from.
 *
 * The step buttons exist because the two selects are independent: each one
 * preserved the other half, so moving from Dec 2026 to Jan 2027 — the single
 * most common move a filing period makes — was two separate interactions with
 * no carry between them, and it was easy to land on Jan 2026 in passing.
 * Stepping treats the period as one value, so the year rolls with the month.
 */
export const PeriodPicker = forwardRef<HTMLSelectElement, PeriodPickerProps>(
  function PeriodPicker({ value, onChange, label }, ref) {
    const [year, month] = value.split('-')

    const years = useMemo(() => {
      const current = new Date().getFullYear()
      const result: number[] = []
      for (let y = current + 1; y >= current - 5; y--) {
        result.push(y)
      }
      return result
    }, [])

    const maxYear = years[0]
    const minYear = years[years.length - 1]

    function handleMonthChange(m: string) {
      onChange(`${year}-${m}`)
    }

    function handleYearChange(y: string) {
      onChange(`${y}-${month}`)
    }

    /** One month forward or back, carrying into the year and stopping at the ends. */
    function step(delta: number) {
      const y = Number(year)
      const m = Number(month)
      if (!Number.isFinite(y) || !Number.isFinite(m)) return
      const index = y * 12 + (m - 1) + delta
      const nextYear = Math.floor(index / 12)
      const nextMonth = index - nextYear * 12 + 1
      if (nextYear < minYear || nextYear > maxYear) return
      onChange(`${nextYear}-${String(nextMonth).padStart(2, '0')}`)
    }

    const atStart = Number(year) <= minYear && month === '01'
    const atEnd = Number(year) >= maxYear && month === '12'

    const selectClass =
      'px-2.5 py-1.5 text-sm border border-slate-200 rounded-lg bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition'

    // aria-disabled, not disabled: at either end the button stays in the tab
    // order instead of vanishing from under the finger that just pressed it.
    const stepClass =
      'px-1.5 py-2 border border-slate-200 rounded-lg bg-white text-slate-500 hover:bg-slate-50 ' +
      'aria-disabled:opacity-40 aria-disabled:cursor-default ' +
      'focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition'

    const name = label ?? 'Period'

    return (
      // Two bare selects side by side announce only their current value, which
      // tells a keyboard user nothing about which half they are on.
      <div className="flex items-center gap-1.5" role="group" aria-label={name}>
        <button
          type="button"
          onClick={() => step(-1)}
          aria-disabled={atStart}
          aria-label={`Previous month — ${name}`}
          title="Previous month"
          className={stepClass}
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <select
          ref={ref}
          value={month}
          onChange={(e) => handleMonthChange(e.target.value)}
          className={selectClass}
          aria-label={`${name} month`}
        >
          {MONTHS.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
        <select
          value={year}
          onChange={(e) => handleYearChange(e.target.value)}
          className={selectClass}
          aria-label={`${name} year`}
        >
          {years.map((y) => (
            <option key={y} value={String(y)}>
              {y}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => step(1)}
          aria-disabled={atEnd}
          aria-label={`Next month — ${name}`}
          title="Next month"
          className={stepClass}
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    )
  },
)
