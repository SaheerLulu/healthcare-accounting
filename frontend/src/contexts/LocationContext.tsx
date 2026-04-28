import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react'
import { getUserLocations, type UserLocation } from '../lib/api'

interface LocationContextType {
  locations: UserLocation[]
  activeLocationId: number | null
  activeLocation: UserLocation | null
  canSeeAll: boolean
  isLoading: boolean
  setActiveLocation: (id: number | null) => void
}

const LocationContext = createContext<LocationContextType | null>(null)

const STORAGE_KEY = 'accounting_active_location'

function persistLocation(id: number | null) {
  localStorage.setItem(STORAGE_KEY, id === null ? 'all' : String(id))
}

export function LocationProvider({ children }: { children: ReactNode }) {
  const [locations, setLocations] = useState<UserLocation[]>([])
  const [activeLocationId, setActiveLocationId] = useState<number | null>(null)
  const [canSeeAll, setCanSeeAll] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const data = await getUserLocations()
        if (cancelled) return
        setLocations(data.locations)
        setCanSeeAll(data.can_see_all)

        // Restore from localStorage or use default. The single useEffect below
        // mirrors state→localStorage on every change, so this block only sets
        // state — it never writes localStorage directly.
        const stored = localStorage.getItem(STORAGE_KEY)
        if (stored === 'all' && data.can_see_all) {
          setActiveLocationId(null)
        } else if (stored) {
          const id = parseInt(stored, 10)
          const valid = data.locations.some((l) => l.id === id)
          if (valid) {
            setActiveLocationId(id)
          } else if (data.can_see_all) {
            setActiveLocationId(null)
          } else {
            const def = data.locations.find((l) => l.is_default) || data.locations[0]
            if (def) setActiveLocationId(def.id)
          }
        } else {
          const def = data.locations.find((l) => l.is_default)
          if (def) {
            setActiveLocationId(def.id)
          } else if (data.can_see_all) {
            setActiveLocationId(null)
          } else if (data.locations[0]) {
            setActiveLocationId(data.locations[0].id)
          }
        }
      } catch {
        // If fetch fails, keep loading state so UI can retry
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  // Mirror state to localStorage on every change once initial load is done.
  useEffect(() => {
    if (!isLoading) persistLocation(activeLocationId)
  }, [activeLocationId, isLoading])

  const setActiveLocation = useCallback((id: number | null) => {
    setActiveLocationId(id)
  }, [])

  const activeLocation = locations.find((l) => l.id === activeLocationId) || null

  return (
    <LocationContext.Provider
      value={{ locations, activeLocationId, activeLocation, canSeeAll, isLoading, setActiveLocation }}
    >
      {children}
    </LocationContext.Provider>
  )
}

export function useLocation() {
  const ctx = useContext(LocationContext)
  if (!ctx) throw new Error('useLocation must be used within LocationProvider')
  return ctx
}
