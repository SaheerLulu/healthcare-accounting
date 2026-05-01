interface Props {
  data: number[]
  width?: number
  height?: number
  color?: string
  showDot?: boolean
  fillOpacity?: number
  className?: string
}

export function MiniSparkline({
  data,
  width = 64,
  height = 24,
  color = 'var(--brand)',
  showDot = true,
  fillOpacity = 0.1,
  className,
}: Props) {
  if (data.length < 2) return null

  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1
  const pad = 2

  const points = data.map((v, i) => {
    const x = pad + (i / (data.length - 1)) * (width - pad * 2)
    const y = pad + (1 - (v - min) / range) * (height - pad * 2)
    return `${x},${y}`
  })

  const last = data.length - 1
  const lastX = pad + (last / (data.length - 1)) * (width - pad * 2)
  const lastY = pad + (1 - (data[last] - min) / range) * (height - pad * 2)

  return (
    <svg width={width} height={height} className={className} viewBox={`0 0 ${width} ${height}`}>
      {fillOpacity > 0 && (
        <polygon
          points={`${points.join(' ')} ${pad + (width - pad * 2)},${height - pad} ${pad},${height - pad}`}
          fill={color}
          opacity={fillOpacity}
        />
      )}
      <polyline
        points={points.join(' ')}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {showDot && <circle cx={lastX} cy={lastY} r={2} fill={color} />}
    </svg>
  )
}
