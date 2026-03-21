import { Activity, Package, TrendingUp, AlertTriangle, Clock, CheckCircle } from 'lucide-react'
import { useVenue } from '@/features/venues/VenueProvider'
import { useAuth } from '@/features/auth/AuthProvider'
import { StatusChip } from '@/components/ui/StatusChip'

// ─── KPI Card ────────────────────────────────────────────────

interface KpiCardProps {
  label: string
  value: string | number
  sub?: string
  icon: React.ReactNode
  trend?: 'up' | 'down' | 'neutral'
  status?: 'success' | 'warning' | 'danger' | 'info' | 'neutral'
}

function KpiCard({ label, value, sub, icon, status = 'neutral' }: KpiCardProps) {
  const iconBg: Record<string, string> = {
    success: 'bg-success/10 text-success',
    warning: 'bg-warning/10 text-warning',
    danger:  'bg-danger/10 text-danger',
    info:    'bg-info/10 text-info',
    neutral: 'bg-surface-2 text-slate-400',
  }

  return (
    <div className="bg-surface-1 border border-surface-2 rounded-2xl p-4 flex items-start gap-4">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${iconBg[status]}`}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-xs text-slate-500 font-medium truncate">{label}</p>
        <p className="text-xl font-bold text-slate-100 mt-0.5">{value}</p>
        {sub && <p className="text-xs text-slate-500 mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}

// ─── Activity Row ────────────────────────────────────────────

interface ActivityRowProps {
  action: string
  actor: string
  time: string
  status: 'approved' | 'pending' | 'rejected'
}

function ActivityRow({ action, actor, time, status }: ActivityRowProps) {
  const chipVariant = status === 'approved' ? 'success' : status === 'rejected' ? 'danger' : 'warning'
  return (
    <div className="flex items-center justify-between py-3 border-b border-surface-2 last:border-0 gap-3">
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-7 h-7 rounded-full bg-surface-2 flex items-center justify-center flex-shrink-0 text-xs font-semibold text-slate-300">
          {actor[0].toUpperCase()}
        </div>
        <div className="min-w-0">
          <p className="text-sm text-slate-200 truncate">{action}</p>
          <p className="text-xs text-slate-500">{actor}</p>
        </div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <StatusChip label={status} variant={chipVariant} size="sm" />
        <span className="text-xs text-slate-500">{time}</span>
      </div>
    </div>
  )
}

// ─── Page ────────────────────────────────────────────────────

export function DashboardPage() {
  const { activeVenue } = useVenue()
  const { profile } = useAuth()

  const greeting = () => {
    const h = new Date().getHours()
    if (h < 12) return 'Good morning'
    if (h < 18) return 'Good afternoon'
    return 'Good evening'
  }

  return (
    <div className="space-y-6">

      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-slate-100">
          {greeting()}, {profile?.display_name ?? profile?.full_name?.split(' ')[0]}
        </h1>
        <p className="text-sm text-slate-400 mt-0.5">
          {activeVenue?.name} · {new Date().toLocaleDateString('en-CA', {
            weekday: 'long', month: 'long', day: 'numeric',
          })}
        </p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          label="Events Today"
          value="—"
          sub="Pending sync"
          icon={<Activity size={18} />}
          status="neutral"
        />
        <KpiCard
          label="Low Stock Items"
          value="—"
          sub="Below par level"
          icon={<AlertTriangle size={18} />}
          status="neutral"
        />
        <KpiCard
          label="Pending Approvals"
          value="—"
          sub="Events to review"
          icon={<Clock size={18} />}
          status="neutral"
        />
        <KpiCard
          label="Warehouse Stock"
          value="—"
          sub="Total SKUs tracked"
          icon={<Package size={18} />}
          status="neutral"
        />
      </div>

      {/* Two column layout on desktop */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Recent activity */}
        <div className="bg-surface-1 border border-surface-2 rounded-2xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
              <Activity size={15} className="text-brand-400" />
              Recent Activity
            </h2>
          </div>
          <div className="space-y-0">
            <ActivityRow action="Hendricks 750ml — 2 bottles" actor="System" time="now" status="pending" />
          </div>
          <p className="text-xs text-slate-500 text-center py-6">
            Live activity will appear here once operations begin.
          </p>
        </div>

        {/* Quick stats */}
        <div className="bg-surface-1 border border-surface-2 rounded-2xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
              <TrendingUp size={15} className="text-brand-400" />
              Tonight at a Glance
            </h2>
          </div>
          <div className="space-y-3 py-2">
            {[
              { label: 'Active night', value: 'None open' },
              { label: 'Staff on floor', value: '—' },
              { label: 'Events submitted', value: '—' },
              { label: 'Events approved', value: '—' },
            ].map(row => (
              <div key={row.label} className="flex items-center justify-between">
                <span className="text-sm text-slate-400">{row.label}</span>
                <span className="text-sm font-medium text-slate-200">{row.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Setup prompt — shown until master data exists */}
      <div className="flex items-start gap-3 px-4 py-3 bg-info/5 border border-info/20 rounded-2xl">
        <CheckCircle size={16} className="text-info flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-medium text-slate-200">Getting started</p>
          <p className="text-xs text-slate-400 mt-0.5">
            Head to <strong className="text-slate-300">Setup</strong> to add your bars, stations, items, and staff before opening your first night.
          </p>
        </div>
      </div>

    </div>
  )
}
