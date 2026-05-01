import { ChevronUp, ChevronDown, Minus } from 'lucide-react'

interface Props {
  value: number
  isPositiveGood?: boolean
  size?: 'sm' | 'md'
  className?: string
}

export function TrendBadge({ value, isPositiveGood = true, size = 'sm', className = '' }: Props) {
  const abs = Math.abs(value)
  const isUp = value > 1
  const isDown = value < -1
  const isFlat = !isUp && !isDown

  const isGood = isFlat ? null : (isUp && isPositiveGood) || (isDown && !isPositiveGood)
  const color = isFlat ? 'text-gray-400' : isGood ? 'text-green-600' : 'text-red-500'
  const bg = isFlat ? 'bg-gray-50' : isGood ? 'bg-green-50' : 'bg-red-50'

  const iconSize = size === 'sm' ? 'w-3 h-3' : 'w-3.5 h-3.5'
  const textSize = size === 'sm' ? 'text-[10px]' : 'text-xs'

  const Icon = isUp ? ChevronUp : isDown ? ChevronDown : Minus

  return (
    <span
      className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full font-medium mono ${color} ${bg} ${textSize} ${className}`}
    >
      <Icon className={iconSize} />
      {abs.toFixed(1)}%
    </span>
  )
}
