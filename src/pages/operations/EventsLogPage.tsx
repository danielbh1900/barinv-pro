import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { CheckCircle, XCircle, Filter } from 'lucide-react'
import { supabase } from '@/lib/supabase/client'
import { useVenue } from '@/features/venues/VenueProvider'
import { useAuth } from '@/features/auth/AuthProvider'
import { useToast } from '@/components/ui/Toast'
import { can } from '@/lib/permissions'
import { StatusChip } from '@/components/ui/StatusChip'
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { formatDistanceToNow } from 'date-fns'

interface EventRow {
  id: string
  event_type: string
  status: 'pending' | 'approved' | 'rejected' | 'voided'
  quantity: number
  reason_note: string | null
  created_at: string
  submitted_by: string
  items: { name: string } | null
  units: { abbreviation: string } | null
  stations: { name: string } | null
  profiles: { full_name: string } | null
}

const STATUS_CHIP: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  approved: 'success',
  pending:  'warning',
  rejected: 'danger',
  voided:   'neutral',
}

export function EventsLogPage() {
  const { activeVenue } = useVenue()
  const { profile } = useAuth()
  const toast = useToast()
  const queryClient = useQueryClient()

  const venueId = activeVenue?.id ?? ''
  const role    = (profile as unknown as { role?: string })?.role ?? 'bartender'

  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [approving, setApproving] = useState<EventRow | null>(null)
  const [rejecting, setRejecting] = useState<EventRow | null>(null)

  const { data: events = [], isLoading } = useQuery({
    queryKey: ['events', venueId, statusFilter],
    queryFn: async () => {
      let query = supabase
        .from('events')
        .select('id, event_type, status, quantity, reason_note, created_at, submitted_by, items(name), units(abbreviation), stations(name), profiles(full_name)')
        .eq('venue_id', venueId)
        .order('created_at', { ascending: false })
        .limit(100)

      if (statusFilter !== 'all') query = query.eq('status', statusFilter)

      const { data, error } = await query
      if (error) throw error
      return data as unknown as EventRow[]
    },
    enabled: !!venueId,
  })

  const approveMutation = useMutation({
    mutationFn: async (event: EventRow) => {
      const { error } = await supabase.from('events').update({ status: 'approved', approved_by: profile?.id }).eq('id', event.id)
      if (error) throw error
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['events', venueId] }); toast.success('Event approved.'); setApproving(null) },
    onError: (err: Error) => toast.error(err.message),
  })

  const rejectMutation = useMutation({
    mutationFn: async (event: EventRow) => {
      const { error } = await supabase.from('events').update({ status: 'rejected', rejected_by: profile?.id }).eq('id', event.id)
      if (error) throw error
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['events', venueId] }); toast.success('Event rejected.'); setRejecting(null) },
    onError: (err: Error) => toast.error(err.message),
  })

  const canApprove = can.approveEvent(role as never)

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-100">Events Log</h1>
        <div className="flex items-center gap-2">
          <Filter size={14} className="text-slate-400" />
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="bg-surface-1 border border-surface-3 text-slate-200 text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-brand-500"
          >
            <option value="all">All</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>
      </div>

      {isLoading && <LoadingSkeleton variant="row" rows={5} />}

      {!isLoading && events.length === 0 && (
        <EmptyState icon="📋" title="No events found" description="Events submitted during a night will appear here." />
      )}

      {!isLoading && events.length > 0 && (
        <div className="space-y-2">
          {events.map(event => (
            <div key={event.id} className="bg-surface-1 border border-surface-2 rounded-2xl px-4 py-3 flex items-center justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-slate-200">
                    {event.quantity} × {event.units?.abbreviation ?? '?'} {event.items?.name ?? 'Unknown item'}
                  </span>
                  <StatusChip label={event.status} variant={STATUS_CHIP[event.status] ?? 'neutral'} size="sm" />
                </div>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  <span className="text-xs text-slate-400 capitalize">{event.event_type.replace('_', ' ')}</span>
                  <span className="text-slate-600">·</span>
                  <span className="text-xs text-slate-400">{event.stations?.name ?? '—'}</span>
                  <span className="text-slate-600">·</span>
                  <span className="text-xs text-slate-500">{event.profiles?.full_name ?? '—'}</span>
                  <span className="text-slate-600">·</span>
                  <span className="text-xs text-slate-500">{formatDistanceToNow(new Date(event.created_at), { addSuffix: true })}</span>
                </div>
                {event.reason_note && (
                  <p className="text-xs text-slate-400 mt-1 italic">"{event.reason_note}"</p>
                )}
              </div>

              {canApprove && event.status === 'pending' && (
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button onClick={() => setApproving(event)} className="p-2 text-success hover:bg-success/10 rounded-xl transition-colors" title="Approve">
                    <CheckCircle size={18} />
                  </button>
                  <button onClick={() => setRejecting(event)} className="p-2 text-danger hover:bg-danger/10 rounded-xl transition-colors" title="Reject">
                    <XCircle size={18} />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog open={!!approving} title="Approve event?" description={`Approve ${approving?.quantity} × ${approving?.units?.abbreviation} ${approving?.items?.name}?`} confirmLabel="Approve" variant="default" onConfirm={() => approving && approveMutation.mutate(approving)} onCancel={() => setApproving(null)} />
      <ConfirmDialog open={!!rejecting} title="Reject event?" description={`Reject ${rejecting?.quantity} × ${rejecting?.units?.abbreviation} ${rejecting?.items?.name}?`} confirmLabel="Reject" variant="danger" onConfirm={() => rejecting && rejectMutation.mutate(rejecting)} onCancel={() => setRejecting(null)} />
    </div>
  )
}
