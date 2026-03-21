import { Menu, Bell, ChevronDown } from 'lucide-react'
import { useState } from 'react'
import { useAuth } from '@/features/auth/AuthProvider'
import { useVenue } from '@/features/venues/VenueProvider'
import { VenueSwitcher } from './VenueSwitcher'

export function TopBar() {
  const { profile, signOut } = useAuth()
  const { activeVenue } = useVenue()
  const [showVenueSwitcher, setShowVenueSwitcher] = useState(false)
  const [showUserMenu, setShowUserMenu] = useState(false)

  return (
    <header className="sticky top-0 z-30 bg-surface/80 backdrop-blur-md border-b border-surface-2 px-4 lg:px-8">
      <div className="flex items-center justify-between h-14">
        {/* Left: mobile menu button + venue selector */}
        <div className="flex items-center gap-3">
          {/* Mobile menu button — sidebar toggle handled elsewhere */}
          <button className="lg:hidden p-2 -ml-2 text-slate-400 hover:text-slate-200 transition-colors">
            <Menu size={20} />
          </button>

          {/* Venue selector */}
          {activeVenue && (
            <button
              onClick={() => setShowVenueSwitcher(true)}
              className="flex items-center gap-1.5 text-sm font-medium text-slate-200 hover:text-white transition-colors"
            >
              <span className="max-w-[140px] truncate">{activeVenue.name}</span>
              <ChevronDown size={14} className="text-slate-400 flex-shrink-0" />
            </button>
          )}
        </div>

        {/* Right: notifications + user menu */}
        <div className="flex items-center gap-2">
          <button className="p-2 text-slate-400 hover:text-slate-200 transition-colors relative">
            <Bell size={18} />
            {/* Notification badge — wired up in Phase 2 */}
          </button>

          {/* User avatar / menu */}
          <div className="relative">
            <button
              onClick={() => setShowUserMenu(prev => !prev)}
              className="flex items-center gap-2 p-1.5 rounded-lg hover:bg-surface-1 transition-colors"
            >
              <div className="w-7 h-7 rounded-full bg-brand-600 flex items-center justify-center text-xs font-semibold text-white">
                {profile?.display_name?.[0] ?? profile?.full_name?.[0] ?? '?'}
              </div>
            </button>

            {showUserMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowUserMenu(false)} />
                <div className="absolute right-0 top-full mt-1 z-50 w-48 bg-surface-1 border border-surface-2 rounded-xl shadow-xl py-1 animate-fade-in">
                  <div className="px-3 py-2 border-b border-surface-2">
                    <p className="text-sm font-medium text-slate-200 truncate">
                      {profile?.full_name ?? 'User'}
                    </p>
                  </div>
                  <button
                    onClick={signOut}
                    className="w-full text-left px-3 py-2 text-sm text-danger hover:bg-surface-2 transition-colors"
                  >
                    Sign out
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {showVenueSwitcher && <VenueSwitcher onClose={() => setShowVenueSwitcher(false)} />}
    </header>
  )
}
