import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Play, Square, Plus, Clock } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { supabase } from '@/lib/supabase/client'
import { useVenue } from '@/features/venues/VenueProvider'
import { useAuth } from '@/features/auth/AuthProvider'
import { useToast } from '@/components/ui/Toast'
import { useVenueTimezone } from '@/features/venues/VenueProvider'
import { Field, Input, FormActions } from '@/components/forms/Fields'
import { SlidePanel } from '@/components/ui/SlidePanel'
import { StatusChip } from '@/components/ui/StatusChip'
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'

interface Night {
  id: string
  night_date: string
  label: string | null
  open_at: string | null
  close_at: string | null
  notes: string | null
  created_at: string
}

const nightSchema = z.object({
  night_date: z.string().min(1, 'Date is required'),
  label: z.string().max(120).optional(),
  notes: z.string().max(500).optional(),
})

type NightFormValues = z.infer<typeof nightSchema>

export function NightsPage() {
  const { activeVenue } = useVenue()
  const { profile } = useAuth()
  const timezone = useVenueTimezone()
  const toast = useToast()
  const queryClient = useQueryClient()

  const orgId   = profile?.organization_id ?? ''
  const venueId = activeVenue?.id ?? ''

  const [panelOpen, setPanelOpen]   = useState(false)
  const [closing, setClosing]       = useState<Night | null>(null)

  const { data: nights = [], isLoading } = useQuery({
    queryKey: ['nights', venueId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('nights').select('*')
        .eq('venue_id', venueId)
        .order('night_date', { ascending: false })
        .limit(30)
      if (error) throw error
      return data as Night[]
    },
    enabled: !!venueId,
  })

  const openNight = nights.find(n => n.open_at && !n.close_at)

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<NightFormValues>({
    resolver: zodResolver(nightSchema),
    defaultValues: { night_date: format(new Date(), 'yyyy-MM-dd') },
  })

  const openNightMutation = useMutation({
    mutationFn: async (values: NightFormValues) => {
      // Check for duplicate date
      const { data: existing } = await supabase
        .from('nights').select('id').eq('venue_id', venueId).eq('night_date', values.night_date).single()
      if (existing) throw new Error(`A night already exists for ${values.night_date}.`)

      const { error } = await supabase.from('nights').insert({
        organization_id: orgId,
        venue_id:        venueId,
        night_date:      values.night_date,
        label:           values.label || null,
        notes:           values.notes || null,
        open_at:         new Date().toISOString(),
        created_by:      profile?.id,
        updated_by:      profile?.id,
      })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['nights', venueId] })
      queryClient.invalidateQueries({ queryKey: ['nights-open', venueId] })
      toast.success('Night opened.')
      setPanelOpen(false)
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const closeNightMutation = useMutation({
    mutationFn: async (night: Night) => {
      const { error } = await supabase.from('nights').update({
        close_at:   new Date().toISOString(),
        closed_by:  profile?.id,
        updated_by: profile?.id,
      }).eq('id', night.id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['nights', venueId] })
      queryClient.invalidateQueries({ queryKey: ['nights-open', venueId] })
      toast.success('Night closed.')
      setClosing(null)
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const isNightOpen = (n: Night) => !!n.open_at && !n.close_at

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-100">Nights</h1>
          <p className="text-sm text-slate-400 mt-0.5">{activeVenue?.name} · {timezone}</p>
        </div>
        {!openNight && (
          <button
            onClick={() => { reset({ night_date: format(new Date(), 'yyyy-MM-dd') }); setPanelOpen(true) }}
            className="flex items-center gap-2 px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium rounded-xl transition-colors"
          >
            <Plus size={16} />
            Open Night
          </button>
        )}
      </div>

      {/* Currently open night */}
      {openNight && (
        <div className="bg-success/5 border border-success/20 rounded-2xl px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="w-2 h-2 rounded-full bg-success animate-pulse" />
                <span className="text-xs font-semibold text-success uppercase tracking-wider">Night in Progress</span>
              </div>
              <p className="text-base font-semibold text-slate-100">
                {openNight.label ?? openNight.night_date}
              </p>
              <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-1">
                <Clock size={11} />
                Opened {format(parseISO(openNight.open_at!), 'HH:mm')}
              </p>
            </div>
            <button
              onClick={() => setClosing(openNight)}
              className="flex items-center gap-2 px-3 py-2 bg-surface-2 hover:bg-surface-3 border border-surface-3 text-slate-200 text-sm font-medium rounded-xl transition-colors flex-shrink-0"
            >
              <Square size={14} />
              Close Night
            </button>
          </div>
        </div>
      )}

      {/* History */}
      {isLoading && <LoadingSkeleton variant="row" rows={4} />}

      {!isLoading && nights.filter(n => !isNightOpen(n)).length === 0 && !openNight && (
        <EmptyState icon="🌙" title="No nights yet" description="Open your first night to start tracking events." />
      )}

      <div className="space-y-2">
        {nights
          .filter(n => !isNightOpen(n))
          .map(night => (
            <div key={night.id} className="bg-surface-1 border border-surface-2 rounded-xl px-4 py-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-slate-200">
                  {night.label ?? night.night_date}
                </p>
                <p className="text-xs text-slate-500 mt-0.5">
                  {night.night_date}
                  {night.open_at && night.close_at && (
                    <> · {format(parseISO(night.open_at), 'HH:mm')} → {format(parseISO(night.close_at), 'HH:mm')}</>
                  )}
                </p>
              </div>
              <StatusChip
                label={night.close_at ? 'Closed' : 'Open'}
                variant={night.close_at ? 'neutral' : 'success'}
                size="sm"
              />
            </div>
          ))}
      </div>

      {/* Open night panel */}
      <SlidePanel open={panelOpen} title="Open Night" description="Start a new shift at this venue." onClose={() => setPanelOpen(false)}>
        <form onSubmit={handleSubmit(v => openNightMutation.mutate(v))} noValidate className="space-y-5">
          <Field label="Night date" error={errors.night_date?.message} hint="The local date this shift belongs to." required>
            <input
              type="date"
              {...register('night_date')}
              className="w-full px-4 py-2.5 rounded-xl bg-surface text-slate-100 text-sm border border-surface-3 focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </Field>
          <Field label="Label" hint="Optional event name, e.g. 'Friday Night', 'NYE 2025'.">
            <input {...register('label')} placeholder="e.g. Friday Night" className="w-full px-4 py-2.5 rounded-xl bg-surface text-slate-100 text-sm border border-surface-3 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500" />
          </Field>
          <Field label="Notes" hint="Optional.">
            <textarea {...register('notes')} rows={2} placeholder="Any shift notes..." className="w-full px-4 py-2.5 rounded-xl bg-surface text-slate-100 text-sm border border-surface-3 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none" />
          </Field>
          <FormActions onCancel={() => setPanelOpen(false)} isSubmitting={isSubmitting || openNightMutation.isPending} submitLabel="Open Night" />
        </form>
      </SlidePanel>

      {/* Close night confirm */}
      <ConfirmDialog
        open={!!closing}
        title="Close night?"
        description={`Close "${closing?.label ?? closing?.night_date}"? Staff will no longer be able to submit events for this night.`}
        confirmLabel="Close Night"
        variant="warning"
        onConfirm={() => closing && closeNightMutation.mutate(closing)}
        onCancel={() => setClosing(null)}
      />
    </div>
  )
}
