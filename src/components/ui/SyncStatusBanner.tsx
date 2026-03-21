// ============================================================
// SyncStatusBanner
// Shows pending / failed offline queue count.
// Wired to offline queue in Phase 2.
// ============================================================

import { WifiOff, RefreshCw, AlertCircle } from 'lucide-react'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'

interface SyncStatusBannerProps {
  pendingCount?: number
  failedCount?: number
  conflictCount?: number
  onRetry?: () => void
  onViewConflicts?: () => void
}

export function SyncStatusBanner({
  pendingCount = 0,
  failedCount = 0,
  conflictCount = 0,
  onRetry,
  onViewConflicts,
}: SyncStatusBannerProps) {
  const isOnline = useOnlineStatus()

  if (isOnline && pendingCount === 0 && failedCount === 0 && conflictCount === 0) return null

  if (!isOnline) return null // OfflineIndicator handles offline state

  if (failedCount > 0) {
    return (
      <div className="bg-danger/10 border-b border-danger/20 px-4 py-2 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-danger text-sm">
          <AlertCircle size={15} />
          <span>{failedCount} sync {failedCount === 1 ? 'failure' : 'failures'} — tap to review</span>
        </div>
        {onRetry && (
          <button
            onClick={onRetry}
            className="text-xs font-medium text-danger hover:text-danger/80 transition-colors flex-shrink-0"
          >
            Retry
          </button>
        )}
      </div>
    )
  }

  if (conflictCount > 0) {
    return (
      <div className="bg-warning/10 border-b border-warning/20 px-4 py-2 flex items-center justify-between gap-2 text-warning text-sm">
        <div className="flex items-center gap-2">
          <AlertCircle size={15} />
          <span>{conflictCount} sync {conflictCount === 1 ? 'conflict' : 'conflicts'} require review</span>
        </div>
        {onViewConflicts && (
          <button onClick={onViewConflicts} className="text-xs font-medium text-warning hover:text-warning/80 transition-colors flex-shrink-0">
            Review
          </button>
        )}
      </div>
    )
  }

  if (pendingCount > 0) {
    return (
      <div className="bg-info/10 border-b border-info/20 px-4 py-2 flex items-center gap-2 text-info text-sm">
        <RefreshCw size={15} className="animate-spin" />
        <span>Syncing {pendingCount} {pendingCount === 1 ? 'item' : 'items'}...</span>
      </div>
    )
  }

  return null
}

// ============================================================
// OfflineIndicator
// Full-width banner shown when device is offline.
// ============================================================

export function OfflineIndicator() {
  const isOnline = useOnlineStatus()

  if (isOnline) return null

  return (
    <div className="bg-surface-2 border-b border-surface-3 px-4 py-2 flex items-center gap-2 text-slate-300 text-sm">
      <WifiOff size={15} className="flex-shrink-0" />
      <span>
        You are offline. Submissions will be queued and synced when connection is restored.
      </span>
    </div>
  )
}

// ============================================================
// PWAUpdateBanner
// Shown when a new service worker is waiting to activate.
// ============================================================

export function PWAUpdateBanner() {
  // TODO: wire to vite-plugin-pwa useRegisterSW hook in Phase 1 PWA step
  // Placeholder — no render until wired
  return null
}
