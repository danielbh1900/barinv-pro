import { Outlet } from 'react-router-dom'
import { Sidebar } from '@/components/ui/Sidebar'
import { MobileNav } from '@/components/ui/MobileNav'
import { TopBar } from '@/components/ui/TopBar'
import { SyncStatusBanner } from '@/components/ui/SyncStatusBanner'
import { OfflineIndicator } from '@/components/pwa/OfflineIndicator'
import { PWAUpdateBanner } from '@/components/pwa/PWAUpdateBanner'
import { useOfflineQueue } from '@/hooks/useOfflineQueue'
import { useNavigate } from 'react-router-dom'

export function AppLayout() {
  const { pending, failed, conflict, retry } = useOfflineQueue()
  const navigate = useNavigate()

  return (
    <div className="min-h-screen bg-surface flex">
      <aside className="hidden lg:flex lg:flex-shrink-0">
        <Sidebar />
      </aside>

      <div className="flex flex-col flex-1 min-w-0">
        <TopBar />

        <PWAUpdateBanner />
        <SyncStatusBanner
          pendingCount={pending}
          failedCount={failed}
          conflictCount={conflict}
          onRetry={retry}
          onViewConflicts={() => navigate('/settings/diagnostics/sync-conflicts')}
        />
        <OfflineIndicator />

        <main className="flex-1 overflow-auto pb-safe">
          <div className="px-4 py-6 lg:px-8 max-w-7xl mx-auto">
            <Outlet />
          </div>
        </main>

        <nav className="lg:hidden border-t border-surface-2 pb-safe">
          <MobileNav />
        </nav>
      </div>
    </div>
  )
}
