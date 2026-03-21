import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase/client'
import { useVenue } from '@/features/venues/VenueProvider'
import { useAuth } from '@/features/auth/AuthProvider'
import { StatusChip } from '@/components/ui/StatusChip'
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { formatDistanceToNow, format } from 'date-fns'

interface EventRow {
  id: string
  event_type: string
  status: 'pending' | 'approved' | 'rejected' | 'voided'
  quantity: number
  created_at: string
  items: { name: string } | null
  units: { abbreviation: string } | null
  stations: { name: string } | null
  nights: { night_date: string } | null
}

const STATUS_CHIP: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  approved: 'success', pending: 'warning', rejected: 'danger', voided: 'neutral',
}

export function MyHistoryPage() {
  const { activeVenue } = useVenue()
  const { profile } = useAuth()
  const venueId = activeVenue?.id ?? ''

  const { data: events = [], isLoading } = useQuery({
    queryKey: ['my-events', venueId, profile?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('events')
        .select('id, event_type, status, quantity, created_at, items(name), units(abbreviation), stations(name), nights(night_date)')
        .eq('venue_id', venueId)
        .eq('submitted_by', profile?.id ?? '')
        .order('created_at', { ascending: false })
        .limit(200)
      if (error) throw error
      return data as unknown as EventRow[]
    },
    enabled: !!venueId && !!profile?.id,
  })

  // Group by night date
  const grouped = events.reduce<Record<string, EventRow[]>>((acc, e) => {
    const date = e.nights?.night_date ?? format(new Date(e.created_at), 'yyyy-MM-dd')
    if (!acc[date]) acc[date] = []
    acc[date].push(e)
    return acc
  }, {})

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-slate-100">My History</h1>

      {isLoading && <LoadingSkeleton variant="row" rows={5} />}

      {!isLoading && events.length === 0 && (
        <EmptyState icon="📜" title="No events yet" description="Events you submit will appear here." />
      )}

      {!isLoading && Object.entries(grouped).sort(([a], [b]) => b.localeCompare(a)).map(([date, rows]) => (
        <div key={date}>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">{date}</p>
          <div className="space-y-2">
            {rows.map(event => (
              <div key={event.id} className="bg-surface-1 border border-surface-2 rounded-xl px-4 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm text-slate-200">
                    {event.quantity} × {event.units?.abbreviation} {event.items?.name ?? 'Unknown'}
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5 capitalize">
                    {event.event_type.replace('_', ' ')} · {event.stations?.name ?? '—'} · {formatDistanceToNow(new Date(event.created_at), { addSuffix: true })}
                  </p>
                </div>
                <StatusChip label={event.status} variant={STATUS_CHIP[event.status] ?? 'neutral'} size="sm" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
