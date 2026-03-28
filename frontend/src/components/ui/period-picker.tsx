import { useMemo } from 'react'

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
}

export function PeriodPicker({ value, onChange }: PeriodPickerProps) {
  const [year, month] = value.split('-')

  const years = useMemo(() => {
    const current = new Date().getFullYear()
    const result: number[] = []
    for (let y = current + 1; y >= current - 5; y--) {
      result.push(y)
    }
    return result
  }, [])

  function handleMonthChange(m: string) {
    onChange(`${year}-${m}`)
  }

  function handleYearChange(y: string) {
    onChange(`${y}-${month}`)
  }

  const selectClass =
    'px-2.5 py-1.5 text-sm border border-slate-200 rounded-lg bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition'

  return (
    <div className="flex items-center gap-1.5">
      <select value={month} onChange={(e) => handleMonthChange(e.target.value)} className={selectClass}>
        {MONTHS.map((m) => (
          <option key={m.value} value={m.value}>
            {m.label}
          </option>
        ))}
      </select>
      <select value={year} onChange={(e) => handleYearChange(e.target.value)} className={selectClass}>
        {years.map((y) => (
          <option key={y} value={String(y)}>
            {y}
          </option>
        ))}
      </select>
    </div>
  )
}
