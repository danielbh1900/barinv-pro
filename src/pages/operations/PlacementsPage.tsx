import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, UserCheck, UserX } from 'lucide-react'
import { format } from 'date-fns'
import { supabase } from '@/lib/supabase/client'
import { useVenue } from '@/features/venues/VenueProvider'
import { useAuth } from '@/features/auth/AuthProvider'
import { useToast } from '@/components/ui/Toast'
import { SlidePanel } from '@/components/ui/SlidePanel'
import { Field, Select, FormActions } from '@/components/forms/Fields'
import { StatusChip } from '@/components/ui/StatusChip'
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton'
import { EmptyState } from '@/components/ui/EmptyState'

interface Night   { id: string; night_date: string; label: string | null }
interface Station { id: string; name: string; bar_id: string }
interface Bar     { id: string; name: string }
interface Profile { id: string; full_name: string }

interface Placement {
  id: string
  night_id: string
  station_id: string
  user_id: string
  status: 'open' | 'closed' | 'cancelled'
  created_at: string
  nights: { night_date: string; label: string | null } | null
  stations: { name: string } | null
  profiles: { full_name: string } | null
}

const placementSchema = z.object({
  night_id:   z.string().min(1, 'Night is required'),
  station_id: z.string().min(1, 'Station is required'),
  user_id:    z.string().min(1, 'Staff member is required'),
})

type PlacementFormValues = z.infer<typeof placementSchema>

export function PlacementsPage() {
  const { activeVenue } = useVenue()
  const { profile } = useAuth()
  const toast = useToast()
  const queryClient = useQueryClient()

  const orgId   = profile?.organization_id ?? ''
  const venueId = activeVenue?.id ?? ''

  const [panelOpen, setPanelOpen] = useState(false)
  const [nightFilter, setNightFilter] = useState<string>('open')

  const { data: placements = [], isLoading } = useQuery({
    queryKey: ['placements', venueId, nightFilter],
    queryFn: async () => {
      let query = supabase
        .from('placements')
        .select('id, night_id, station_id, user_id, status, created_at, nights(night_date, label), stations(name), profiles(full_name)')
        .eq('venue_id', venueId)
        .order('created_at', { ascending: false })

      if (nightFilter === 'open') {
        // Join filter: only placements for open nights
        query = query.eq('status', 'open')
      }

      const { data, error } = await query.limit(100)
      if (error) throw error
      return data as unknown as Placement[]
    },
    enabled: !!venueId,
  })

  const { data: nights = [] } = useQuery({
    queryKey: ['nights', venueId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('nights').select('id, night_date, label')
        .eq('venue_id', venueId).order('night_date', { ascending: false }).limit(20)
      if (error) throw error
      return data as Night[]
    },
    enabled: !!venueId,
  })

  const { data: stations = [] } = useQuery({
    queryKey: ['stations', venueId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('stations').select('id, name, bar_id')
        .eq('venue_id', venueId).eq('active', true).order('name')
      if (error) throw error
      return data as Station[]
    },
    enabled: !!venueId,
  })

  const { data: bars = [] } = useQuery({
    queryKey: ['bars', venueId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bars').select('id, name').eq('venue_id', venueId).is('deleted_at', null).order('name')
      if (error) throw error
      return data as Bar[]
    },
    enabled: !!venueId,
  })

  const { data: staff = [] } = useQuery({
    queryKey: ['venue-staff', venueId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('venue_users')
        .select('user_id, profiles(id, full_name)')
        .eq('venue_id', venueId).eq('active', true)
      if (error) throw error
      return (data as unknown as { user_id: string; profiles: Profile | null }[])
        .filter(r => r.profiles)
        .map(r => r.profiles as Profile)
    },
    enabled: !!venueId,
  })

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<PlacementFormValues>({
    resolver: zodResolver(placementSchema),
  })

  const addMutation = useMutation({
    mutationFn: async (values: PlacementFormValues) => {
      const { error } = await supabase.from('placements').insert({
        organization_id: orgId,
        venue_id:        venueId,
        night_id:        values.night_id,
        station_id:      values.station_id,
        user_id:         values.user_id,
        status:          'open',
        created_by:      profile?.id,
        updated_by:      profile?.id,
      })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['placements', venueId] })
      toast.success('Placement added.')
      setPanelOpen(false)
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const closeMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('placements').update({ status: 'closed', end_at: new Date().toISOString(), updated_by: profile?.id }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['placements', venueId] })
      toast.success('Placement closed.')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const barMap = Object.fromEntries(bars.map(b => [b.id, b.name]))

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between">
        <h1 className="text-xl font-bold text-slate-100">Placements</h1>
        <button
          onClick={() => { reset({ night_id: '', station_id: '', user_id: '' }); setPanelOpen(true) }}
          className="flex items-center gap-2 px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium rounded-xl transition-colors"
        >
          <Plus size={16} />
          Add Placement
        </button>
      </div>

      {/* Filter */}
      <div className="flex gap-2">
        {['open', 'all'].map(f => (
          <button
            key={f}
            onClick={() => setNightFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-colors ${nightFilter === f ? 'bg-brand-600 text-white' : 'bg-surface-1 text-slate-400 hover:text-slate-200 border border-surface-2'}`}
          >
            {f === 'open' ? 'Active' : 'All'}
          </button>
        ))}
      </div>

      {isLoading && <LoadingSkeleton variant="row" rows={4} />}

      {!isLoading && placements.length === 0 && (
        <EmptyState icon="👤" title="No placements" description="Assign staff to stations for each night." />
      )}

      <div className="space-y-2">
        {placements.map(p => (
          <div key={p.id} className="bg-surface-1 border border-surface-2 rounded-xl px-4 py-3 flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-sm font-medium text-slate-200">{p.profiles?.full_name ?? '—'}</p>
                <StatusChip label={p.status} variant={p.status === 'open' ? 'success' : 'neutral'} size="sm" />
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                {p.stations?.name ?? '—'} · {p.nights?.label ?? p.nights?.night_date ?? '—'}
              </p>
            </div>
            {p.status === 'open' && (
              <button
                onClick={() => closeMutation.mutate(p.id)}
                disabled={closeMutation.isPending}
                className="p-2 text-slate-400 hover:text-danger hover:bg-danger/10 rounded-xl transition-colors"
                title="Close placement"
              >
                <UserX size={16} />
              </button>
            )}
          </div>
        ))}
      </div>

      <SlidePanel open={panelOpen} title="Add Placement" description="Assign a staff member to a station for a night." onClose={() => setPanelOpen(false)}>
        <form onSubmit={handleSubmit(v => addMutation.mutate(v))} noValidate className="space-y-5">
          <Field label="Night" error={errors.night_id?.message} required>
            <Select {...register('night_id')} error={!!errors.night_id} placeholder="Select night...">
              {nights.map(n => <option key={n.id} value={n.id}>{n.label ?? n.night_date}</option>)}
            </Select>
          </Field>
          <Field label="Station" error={errors.station_id?.message} required>
            <Select {...register('station_id')} error={!!errors.station_id} placeholder="Select station...">
              {bars.map(bar => {
                const bs = stations.filter(s => s.bar_id === bar.id)
                if (!bs.length) return null
                return (
                  <optgroup key={bar.id} label={bar.name}>
                    {bs.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </optgroup>
                )
              })}
            </Select>
          </Field>
          <Field label="Staff member" error={errors.user_id?.message} required>
            <Select {...register('user_id')} error={!!errors.user_id} placeholder="Select staff...">
              {staff.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
            </Select>
          </Field>
          <FormActions onCancel={() => setPanelOpen(false)} isSubmitting={isSubmitting || addMutation.isPending} submitLabel="Add Placement" />
        </form>
      </SlidePanel>
    </div>
  )
}
