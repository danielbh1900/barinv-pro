import { useState, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useQuery } from '@tanstack/react-query'
import { CheckCircle, WifiOff, Send } from 'lucide-react'
import { supabase } from '@/lib/supabase/client'
import { useVenue } from '@/features/venues/VenueProvider'
import { useAuth } from '@/features/auth/AuthProvider'
import { useToast } from '@/components/ui/Toast'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'
import { enqueue } from '@/lib/offline/queue'
import { processQueue } from '@/lib/offline/sync'
import { Field, Select, Input, Textarea } from '@/components/forms/Fields'

interface Night   { id: string; night_date: string; label: string | null }
interface Station { id: string; name: string; bar_id: string }
interface Bar     { id: string; name: string }
interface Item    { id: string; name: string; category: string }
interface Unit    { id: string; name: string; abbreviation: string }

const EVENT_TYPES = [
  { value: 'bottle_service', label: 'Bottle Service' },
  { value: 'spillage',       label: 'Spillage' },
  { value: 'breakage',       label: 'Breakage' },
  { value: 'comp',           label: 'Comp' },
  { value: 'void',           label: 'Void' },
  { value: 'transfer',       label: 'Transfer' },
  { value: 'other',          label: 'Other' },
]

const eventSchema = z.object({
  night_id:    z.string().min(1, 'Night is required'),
  station_id:  z.string().min(1, 'Station is required'),
  event_type:  z.enum(['bottle_service','spillage','breakage','comp','void','transfer','other']),
  item_id:     z.string().min(1, 'Item is required'),
  unit_id:     z.string().min(1, 'Unit is required'),
  quantity:    z.string().min(1, 'Quantity is required')
               .transform(v => parseFloat(v))
               .refine(v => v > 0, 'Must be greater than 0'),
  reason_note: z.string().max(500).optional(),
})

type EventFormValues = z.infer<typeof eventSchema>

interface SubmitResult {
  offline: boolean
  itemName: string
  quantity: number
  unitAbbrev: string
  eventType: string
}

export function SubmitEventPage() {
  const { activeVenue } = useVenue()
  const { profile } = useAuth()
  const toast = useToast()
  const isOnline = useOnlineStatus()

  const orgId   = profile?.organization_id ?? ''
  const venueId = activeVenue?.id ?? ''

  const [lastResult, setLastResult] = useState<SubmitResult | null>(null)

  const { data: nights = [] } = useQuery({
    queryKey: ['nights-open', venueId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('nights').select('id, night_date, label')
        .eq('venue_id', venueId).is('close_at', null)
        .order('night_date', { ascending: false }).limit(10)
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
        .from('bars').select('id, name')
        .eq('venue_id', venueId).is('deleted_at', null).order('name')
      if (error) throw error
      return data as Bar[]
    },
    enabled: !!venueId,
  })

  const { data: items = [] } = useQuery({
    queryKey: ['items', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('items').select('id, name, category')
        .eq('organization_id', orgId).is('deleted_at', null).order('name')
      if (error) throw error
      return data as Item[]
    },
    enabled: !!orgId,
  })

  const { data: units = [] } = useQuery({
    queryKey: ['units', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('units').select('id, name, abbreviation')
        .eq('organization_id', orgId).eq('active', true).order('name')
      if (error) throw error
      return data as Unit[]
    },
    enabled: !!orgId,
  })

  const {
    register, handleSubmit, reset, watch,
    formState: { errors, isSubmitting },
  } = useForm<EventFormValues>({
    resolver: zodResolver(eventSchema),
    defaultValues: { event_type: 'bottle_service' },
  })

  useEffect(() => {
    if (nights.length > 0) reset(prev => ({ ...prev, night_id: nights[0].id }))
  }, [nights, reset])

  const selectedEventType = watch('event_type')
  const unitMap = Object.fromEntries(units.map(u => [u.id, u]))
  const itemMap = Object.fromEntries(items.map(i => [i.id, i]))

  const onSubmit = async (values: EventFormValues) => {
    const item  = itemMap[values.item_id]
    const unit  = unitMap[values.unit_id]
    const label = EVENT_TYPES.find(e => e.value === values.event_type)?.label ?? values.event_type

    const payload: Record<string, unknown> = {
      organization_id:    orgId,
      venue_id:           venueId,
      night_id:           values.night_id,
      station_id:         values.station_id,
      submitted_by:       profile?.id,
      event_type:         values.event_type,
      status:             'pending',
      item_id:            values.item_id,
      unit_id:            values.unit_id,
      quantity:           values.quantity,
      reason_note:        values.reason_note ?? null,
      submitted_at_local: new Date().toISOString(),
    }

    try {
      const clientOpId = await enqueue('submit_event', 'events', payload)
      payload.client_operation_id = clientOpId

      if (isOnline) {
        const { error } = await supabase.from('events').insert(payload)
        if (!error) processQueue()
      }

      setLastResult({ offline: !isOnline, itemName: item?.name ?? '', quantity: values.quantity, unitAbbrev: unit?.abbreviation ?? '', eventType: label })
      if (isOnline) toast.success('Event submitted.')

      reset({ night_id: values.night_id, station_id: values.station_id, event_type: values.event_type, item_id: '', unit_id: '', quantity: undefined, reason_note: '' })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to submit event.')
    }
  }

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-100">Submit Event</h1>
          <p className="text-sm text-slate-400 mt-0.5">{activeVenue?.name}</p>
        </div>
        {!isOnline && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-surface-2 rounded-xl text-xs text-slate-400">
            <WifiOff size={13} />Offline
          </div>
        )}
      </div>

      {lastResult && (
        <div className={`flex items-start gap-3 px-4 py-3 rounded-2xl border ${lastResult.offline ? 'bg-warning/5 border-warning/20' : 'bg-success/5 border-success/20'}`}>
          {lastResult.offline
            ? <WifiOff size={16} className="text-warning flex-shrink-0 mt-0.5" />
            : <CheckCircle size={16} className="text-success flex-shrink-0 mt-0.5" />}
          <div>
            <p className={`text-sm font-medium ${lastResult.offline ? 'text-warning' : 'text-success'}`}>
              {lastResult.offline ? 'Queued — will sync when online' : 'Event submitted'}
            </p>
            <p className="text-xs text-slate-400 mt-0.5">
              {lastResult.eventType} · {lastResult.quantity} × {lastResult.unitAbbrev} {lastResult.itemName}
            </p>
          </div>
        </div>
      )}

      {nights.length === 0 && (
        <div className="px-4 py-3 bg-warning/10 border border-warning/20 rounded-2xl text-sm text-warning">
          No open night found. Open a night in Operations → Nights first.
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-5">

        <Field label="Night" error={errors.night_id?.message} required>
          <Select {...register('night_id')} error={!!errors.night_id} placeholder="Select a night...">
            {nights.map(n => (
              <option key={n.id} value={n.id}>{n.label ? `${n.night_date} — ${n.label}` : n.night_date}</option>
            ))}
          </Select>
        </Field>

        <Field label="Station" error={errors.station_id?.message} required>
          <Select {...register('station_id')} error={!!errors.station_id} placeholder="Select a station...">
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

        <Field label="Event type" required>
          <div className="grid grid-cols-4 gap-2">
            {EVENT_TYPES.map(et => (
              <label key={et.value} className={`
                flex items-center justify-center py-3 px-1 rounded-xl border cursor-pointer transition-all text-xs font-medium text-center
                ${selectedEventType === et.value
                  ? 'bg-brand-600/20 border-brand-500 text-brand-300'
                  : 'bg-surface border-surface-3 text-slate-400 hover:text-slate-300'}
              `}>
                <input type="radio" value={et.value} {...register('event_type')} className="sr-only" />
                {et.label}
              </label>
            ))}
          </div>
        </Field>

        <Field label="Item" error={errors.item_id?.message} required>
          <Select {...register('item_id')} error={!!errors.item_id} placeholder="Select an item...">
            {['spirit','beer','wine','mixer','garnish','consumable','equipment','other'].map(cat => {
              const ci = items.filter(i => i.category === cat)
              if (!ci.length) return null
              return (
                <optgroup key={cat} label={cat.charAt(0).toUpperCase() + cat.slice(1)}>
                  {ci.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                </optgroup>
              )
            })}
          </Select>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Unit" error={errors.unit_id?.message} required>
            <Select {...register('unit_id')} error={!!errors.unit_id} placeholder="Unit...">
              {units.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </Select>
          </Field>
          <Field label="Quantity" error={errors.quantity?.message} required>
            <Input {...register('quantity')} type="number" inputMode="decimal" min="0.001" step="0.001" placeholder="1" error={!!errors.quantity} />
          </Field>
        </div>

        <Field label="Notes" hint={['spillage','breakage','void','comp'].includes(selectedEventType ?? '') ? 'Recommended for this event type.' : 'Optional.'}>
          <Textarea {...register('reason_note')} rows={2} placeholder="Add a note if needed..." />
        </Field>

        <button
          type="submit"
          disabled={isSubmitting || nights.length === 0}
          className="w-full flex items-center justify-center gap-2 py-3.5 px-4 rounded-2xl font-semibold text-sm text-white bg-brand-600 hover:bg-brand-700 active:bg-brand-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isSubmitting
            ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            : isOnline ? <Send size={16} /> : <WifiOff size={16} />}
          {isSubmitting ? 'Submitting...' : isOnline ? 'Submit Event' : 'Queue for Sync'}
        </button>

      </form>
    </div>
  )
}
