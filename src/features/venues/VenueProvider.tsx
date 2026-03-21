import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from 'react'
import type { Venue, UserRole } from '@/types'
import { supabase } from '@/lib/supabase/client'
import { useAuth } from '@/features/auth/AuthProvider'

// ─── Types ───────────────────────────────────────────────────

interface VenueContextValue {
  activeVenue: Venue | null
  activeRole: UserRole | null
  venues: Venue[]
  isLoading: boolean
  setActiveVenue: (venue: Venue, role: UserRole) => void
  clearActiveVenue: () => void
}

const STORAGE_KEY = 'barinv-active-venue'

// ─── Context ─────────────────────────────────────────────────

const VenueContext = createContext<VenueContextValue | null>(null)

// ─── Provider ────────────────────────────────────────────────

export function VenueProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()

  const [activeVenue, setActiveVenueState] = useState<Venue | null>(null)
  const [activeRole, setActiveRole] = useState<UserRole | null>(null)
  const [venues, setVenues] = useState<Venue[]>([])
  const [isLoading, setIsLoading] = useState(false)

  // Load available venues for this user
  useEffect(() => {
    if (!user) {
      setVenues([])
      return
    }

    setIsLoading(true)

    supabase
      .from('venue_users')
      .select('role, venues(*)')
      .eq('user_id', user.id)
      .eq('active', true)
      .then(({ data, error }) => {
        if (error || !data) {
          setIsLoading(false)
          return
        }

        const venueList = data
          .filter(row => row.venues)
          .map(row => row.venues) as unknown as Venue[]

        setVenues(venueList)

        // Restore previously active venue from sessionStorage
        const stored = sessionStorage.getItem(STORAGE_KEY)
        if (stored) {
          try {
            const { venueId, role } = JSON.parse(stored) as { venueId: string; role: UserRole }
            const matchedVenue = venueList.find(v => v.id === venueId)
            if (matchedVenue) {
              setActiveVenueState(matchedVenue)
              setActiveRole(role)
            }
          } catch {
            sessionStorage.removeItem(STORAGE_KEY)
          }
        }

        setIsLoading(false)
      })
  }, [user])

  const setActiveVenue = useCallback((venue: Venue, role: UserRole) => {
    setActiveVenueState(venue)
    setActiveRole(role)
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ venueId: venue.id, role }))
  }, [])

  const clearActiveVenue = useCallback(() => {
    setActiveVenueState(null)
    setActiveRole(null)
    sessionStorage.removeItem(STORAGE_KEY)
  }, [])

  return (
    <VenueContext.Provider
      value={{ activeVenue, activeRole, venues, isLoading, setActiveVenue, clearActiveVenue }}
    >
      {children}
    </VenueContext.Provider>
  )
}

// ─── Hook ────────────────────────────────────────────────────

export function useVenue(): VenueContextValue {
  const ctx = useContext(VenueContext)
  if (!ctx) throw new Error('useVenue must be used within VenueProvider')
  return ctx
}

export function useVenueTimezone(): string {
  const { activeVenue } = useVenue()
  return activeVenue?.timezone ?? 'UTC'
}
