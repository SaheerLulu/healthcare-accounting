import type { ReactNode } from 'react'
import { useLocation } from 'react-router-dom'

interface Props {
  children: ReactNode
}

export function PageTransition({ children }: Props) {
  const loc = useLocation()
  return (
    <div key={loc.pathname} className="animate-fade-in">
      {children}
    </div>
  )
}
