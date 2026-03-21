import { useNavigate } from 'react-router-dom'
import { RefreshCw, AlertCircle, CheckCircle, AlertTriangle, ChevronRight, Trash2 } from 'lucide-react'
import { useOfflineQueue } from '@/hooks/useOfflineQueue'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'
import { clearSynced } from '@/lib/offline/queue'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/features/auth/AuthProvider'
import { useVenue } from '@/features/venues/VenueProvider'
import { env } from '@/lib/utils/env'

export function DiagnosticsPage() {
  const { pending, failed, conflict, retry, isLoading } = useOfflineQueue()
  const isOnline = useOnlineStatus()
  const { profile } = useAuth()
  const { activeVenue } = useVenue()
  const toast = useToast()
  const navigate = useNavigate()

  const handleClearSynced = async () => {
    await clearSynced()
    toast.success('Synced items cleared from queue.')
  }

  const items = [
    {
      label: 'Connection',
      value: isOnline ? 'Online' : 'Offline',
      icon: isOnline
        ? <CheckCircle size={16} className="text-success" />
        : <AlertCircle size={16} className="text-danger" />,
      status: isOnline ? 'ok' : 'error',
    },
    {
      label: 'Pending queue',
      value: isLoading ? '...' : String(pending),
      icon: pending > 0
        ? <RefreshCw size={16} className="text-info animate-spin" />
        : <CheckCircle size={16} className="text-success" />,
      status: pending > 0 ? 'info' : 'ok',
    },
    {
      label: 'Failed syncs',
      value: isLoading ? '...' : String(failed),
      icon: failed > 0
        ? <AlertCircle size={16} className="text-danger" />
        : <CheckCircle size={16} className="text-success" />,
      status: failed > 0 ? 'error' : 'ok',
    },
    {
      label: 'Conflicts',
      value: isLoading ? '...' : String(conflict),
      icon: conflict > 0
        ? <AlertTriangle size={16} className="text-warning" />
        : <CheckCircle size={16} className="text-success" />,
      status: conflict > 0 ? 'warning' : 'ok',
      action: conflict > 0 ? () => navigate('/settings/diagnostics/sync-conflicts') : undefined,
    },
    {
      label: 'Active venue',
      value: activeVenue?.name ?? '—',
      icon: <CheckCircle size={16} className="text-slate-400" />,
      status: 'neutral',
    },
    {
      label: 'App version',
      value: env.app.version,
      icon: <CheckCircle size={16} className="text-slate-400" />,
      status: 'neutral',
    },
    {
      label: 'Environment',
      value: env.app.env,
      icon: <CheckCircle size={16} className="text-slate-400" />,
      status: 'neutral',
    },
  ]

  return (
    <div className="max-w-md space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-100">Diagnostics</h1>
        <button
          onClick={retry}
          className="flex items-center gap-2 px-3 py-1.5 bg-surface-1 border border-surface-2 hover:bg-surface-2 text-slate-300 text-xs font-medium rounded-xl transition-colors"
        >
          <RefreshCw size={13} />
          Retry sync
        </button>
      </div>

      {/* Status grid */}
      <div className="bg-surface-1 border border-surface-2 rounded-2xl divide-y divide-surface-2">
        {items.map(item => (
          <div
            key={item.label}
            onClick={item.action}
            className={`flex items-center justify-between px-4 py-3 ${item.action ? 'cursor-pointer hover:bg-surface-2 transition-colors' : ''}`}
          >
            <div className="flex items-center gap-3">
              {item.icon}
              <span className="text-sm text-slate-300">{item.label}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-slate-200">{item.value}</span>
              {item.action && <ChevronRight size={14} className="text-slate-500" />}
            </div>
          </div>
        ))}
      </div>

      {/* Actions */}
      <div className="space-y-2">
        <button
          onClick={handleClearSynced}
          className="w-full flex items-center gap-2 px-4 py-3 bg-surface-1 border border-surface-2 hover:bg-surface-2 text-slate-300 text-sm rounded-xl transition-colors"
        >
          <Trash2 size={15} className="text-slate-400" />
          Clear synced items from local queue
        </button>

        {conflict > 0 && (
          <button
            onClick={() => navigate('/settings/diagnostics/sync-conflicts')}
            className="w-full flex items-center gap-2 px-4 py-3 bg-warning/5 border border-warning/20 hover:bg-warning/10 text-warning text-sm rounded-xl transition-colors"
          >
            <AlertTriangle size={15} />
            Review {conflict} sync {conflict === 1 ? 'conflict' : 'conflicts'}
          </button>
        )}

        {failed > 0 && (
          <button
            onClick={retry}
            className="w-full flex items-center gap-2 px-4 py-3 bg-danger/5 border border-danger/20 hover:bg-danger/10 text-danger text-sm rounded-xl transition-colors"
          >
            <RefreshCw size={15} />
            Retry {failed} failed {failed === 1 ? 'item' : 'items'}
          </button>
        )}
      </div>
    </div>
  )
}
