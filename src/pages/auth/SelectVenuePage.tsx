import { useNavigate, useLocation } from 'react-router-dom'
import { Building2, ChevronRight, LogOut, AlertCircle } from 'lucide-react'
import { useAuth } from '@/features/auth/AuthProvider'
import { useVenue } from '@/features/venues/VenueProvider'
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton'
import { ErrorState } from '@/components/ui/ErrorState'
import type { Venue, UserRole } from '@/types'
import { supabase } from '@/lib/supabase/client'
import { useEffect, useState } from 'react'

// ─── Types ───────────────────────────────────────────────────

interface VenueWithRole {
  venue: Venue
  role: UserRole
}

// ─── Component ───────────────────────────────────────────────

export function SelectVenuePage() {
  const { profile, signOut } = useAuth()
  const { setActiveVenue } = useVenue()
  const navigate = useNavigate()
  const location = useLocation()

  const from =
    (location.state as { from?: { pathname: string } })?.from?.pathname ?? '/dashboard'

  const [venues, setVenues] = useState<VenueWithRole[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selecting, setSelecting] = useState<string | null>(null)

  useEffect(() => {
    if (!profile) return

    supabase
      .from('venue_users')
      .select('role, venues(*)')
      .eq('user_id', profile.id)
      .eq('active', true)
      .then(({ data, error: fetchError }) => {
        if (fetchError) {
          setError('Failed to load your venues. Please try again.')
          setIsLoading(false)
          return
        }

        const list: VenueWithRole[] = (data ?? [])
          .filter(row => row.venues)
          .map(row => ({
            venue: row.venues as unknown as Venue,
            role: row.role as UserRole,
          }))

        setVenues(list)
        setIsLoading(false)

        // If only one venue, auto-select it
        if (list.length === 1) {
          handleSelect(list[0])
        }
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile])

  const handleSelect = (item: VenueWithRole) => {
    setSelecting(item.venue.id)
    setActiveVenue(item.venue, item.role)
    navigate(from, { replace: true })
  }

  const handleSignOut = async () => {
    await signOut()
    navigate('/login', { replace: true })
  }

  // ─── Loading ─────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="min-h-screen bg-surface flex flex-col items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm space-y-4">
          <LoadingSkeleton variant="row" rows={3} />
        </div>
      </div>
    )
  }

  // ─── Error ───────────────────────────────────────────────

  if (error) {
    return (
      <div className="min-h-screen bg-surface flex flex-col items-center justify-center px-4">
        <ErrorState message={error} onRetry={() => window.location.reload()} />
      </div>
    )
  }

  // ─── No venues ───────────────────────────────────────────

  if (venues.length === 0) {
    return (
      <div className="min-h-screen bg-surface flex flex-col items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm text-center">
          <div className="text-5xl mb-4">🏢</div>
          <h2 className="text-lg font-semibold text-slate-100 mb-2">No venues assigned</h2>
          <p className="text-sm text-slate-400 mb-6">
            You are not assigned to any venues yet. Contact your administrator.
          </p>
          <div className="flex items-center gap-2 px-4 py-3 bg-surface-1 border border-surface-2 rounded-xl text-sm text-slate-400">
            <AlertCircle size={15} className="flex-shrink-0 text-warning" />
            <span>Signed in as <strong className="text-slate-200">{profile?.full_name}</strong></span>
          </div>
          <button
            onClick={handleSignOut}
            className="mt-4 w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-sm text-slate-400 hover:text-slate-200 hover:bg-surface-1 transition-colors"
          >
            <LogOut size={15} />
            Sign out
          </button>
        </div>
      </div>
    )
  }

  // ─── Venue list ──────────────────────────────────────────

  return (
    <div className="min-h-screen bg-surface flex flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">

        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-white">BARINV Pro</h1>
          <p className="mt-1.5 text-sm text-slate-400">
            Welcome back,{' '}
            <span className="text-slate-200 font-medium">
              {profile?.display_name ?? profile?.full_name}
            </span>
          </p>
          <p className="mt-1 text-sm text-slate-500">Select a venue to continue</p>
        </div>

        {/* Venue cards */}
        <ul className="space-y-2">
          {venues.map(({ venue, role }) => (
            <li key={venue.id}>
              <button
                onClick={() => handleSelect({ venue, role })}
                disabled={selecting !== null}
                className="
                  w-full flex items-center gap-4 px-4 py-4
                  bg-surface-1 hover:bg-surface-2
                  border border-surface-2 hover:border-surface-3
                  rounded-2xl text-left transition-all
                  disabled:opacity-60 disabled:cursor-not-allowed
                  active:scale-[0.99]
                "
              >
                {/* Icon */}
                <div className="w-10 h-10 rounded-xl bg-brand-600/20 flex items-center justify-center flex-shrink-0">
                  {selecting === venue.id ? (
                    <span className="w-4 h-4 border-2 border-brand-400 border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <Building2 size={18} className="text-brand-400" />
                  )}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-100 truncate">{venue.name}</p>
                  <p className="text-xs text-slate-400 capitalize mt-0.5">
                    {role.replace('_', ' ')} · {venue.timezone}
                  </p>
                </div>

                <ChevronRight size={16} className="text-slate-500 flex-shrink-0" />
              </button>
            </li>
          ))}
        </ul>

        {/* Sign out */}
        <button
          onClick={handleSignOut}
          className="
            mt-6 w-full flex items-center justify-center gap-2
            py-2.5 px-4 rounded-xl text-sm text-slate-500
            hover:text-slate-300 hover:bg-surface-1 transition-colors
          "
        >
          <LogOut size={15} />
          Sign out
        </button>
      </div>
    </div>
  )
}
