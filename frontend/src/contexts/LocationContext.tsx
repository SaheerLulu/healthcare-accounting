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

        // Restore from localStorage or use default
        const stored = localStorage.getItem(STORAGE_KEY)
        if (stored === 'all' && data.can_see_all) {
          setActiveLocationId(null)
        } else if (stored) {
          const id = parseInt(stored, 10)
          const valid = data.locations.some((l) => l.id === id)
          if (valid) {
            setActiveLocationId(id)
          } else if (data.can_see_all) {
            // Stored location no longer valid, admin sees all
            setActiveLocationId(null)
            localStorage.setItem(STORAGE_KEY, 'all')
          } else {
            // Non-admin: fall back to default assignment
            const def = data.locations.find((l) => l.is_default) || data.locations[0]
            if (def) {
              setActiveLocationId(def.id)
              localStorage.setItem(STORAGE_KEY, String(def.id))
            }
          }
        } else {
          // No stored value — admins default to "All Locations", others to their default
          const def = data.locations.find((l) => l.is_default)
          if (def) {
            setActiveLocationId(def.id)
            localStorage.setItem(STORAGE_KEY, String(def.id))
          } else if (data.can_see_all) {
            setActiveLocationId(null)
            localStorage.setItem(STORAGE_KEY, 'all')
          } else if (data.locations[0]) {
            setActiveLocationId(data.locations[0].id)
            localStorage.setItem(STORAGE_KEY, String(data.locations[0].id))
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

  const setActiveLocation = useCallback((id: number | null) => {
    setActiveLocationId(id)
    if (id === null) {
      localStorage.setItem(STORAGE_KEY, 'all')
    } else {
      localStorage.setItem(STORAGE_KEY, String(id))
    }
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
