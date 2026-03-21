import { useVenue } from '@/features/venues/VenueProvider'
import { CheckCircle } from 'lucide-react'
import type { UserRole, Venue } from '@/types'

interface VenueSwitcherProps {
  onClose: () => void
}

export function VenueSwitcher({ onClose }: VenueSwitcherProps) {
  const { venues, activeVenue, setActiveVenue } = useVenue()

  // TODO: load role per venue from venue_users — placeholder uses 'bartender'
  const handleSelect = (venue: Venue) => {
    setActiveVenue(venue, 'bartender' as UserRole)
    onClose()
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="absolute top-14 left-0 right-0 z-50 mx-4 bg-surface-1 border border-surface-2 rounded-2xl shadow-xl overflow-hidden animate-fade-in">
        <div className="px-4 py-3 border-b border-surface-2">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Switch Venue</p>
        </div>
        <ul className="py-2 max-h-64 overflow-y-auto">
          {venues.map(venue => (
            <li key={venue.id}>
              <button
                onClick={() => handleSelect(venue)}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-surface-2 transition-colors text-left"
              >
                <div>
                  <p className="text-sm font-medium text-slate-200">{venue.name}</p>
                  <p className="text-xs text-slate-500">{venue.timezone}</p>
                </div>
                {activeVenue?.id === venue.id && (
                  <CheckCircle size={16} className="text-brand-400 flex-shrink-0" />
                )}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </>
  )
}
