import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Pencil, Trash2 } from 'lucide-react'
import { supabase } from '@/lib/supabase/client'
import { useVenue } from '@/features/venues/VenueProvider'
import { useAuth } from '@/features/auth/AuthProvider'
import { useToast } from '@/components/ui/Toast'
import { DataTable, type Column } from '@/components/tables/DataTable'
import { SlidePanel } from '@/components/ui/SlidePanel'
import { SetupPageHeader } from '@/components/ui/SetupPageHeader'
import { Field, Input, Select, FormActions } from '@/components/forms/Fields'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { StatusChip } from '@/components/ui/StatusChip'

interface Station {
  id: string
  name: string
  bar_id: string
  active: boolean
  deleted_at: string | null
  created_at: string
}

interface Bar { id: string; name: string }

const stationSchema = z.object({
  name: z.string().min(1, 'Name is required').max(80),
  bar_id: z.string().min(1, 'Bar is required'),
})

type StationFormValues = z.infer<typeof stationSchema>

export function SetupStationsPage() {
  const { activeVenue } = useVenue()
  const { profile } = useAuth()
  const toast = useToast()
  const queryClient = useQueryClient()
  const orgId = profile?.organization_id ?? ''
  const venueId = activeVenue?.id ?? ''

  const [panelOpen, setPanelOpen] = useState(false)
  const [editing, setEditing] = useState<Station | null>(null)
  const [deleting, setDeleting] = useState<Station | null>(null)

  const { data: stations = [], isLoading } = useQuery({
    queryKey: ['stations', venueId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('stations').select('*')
        .eq('venue_id', venueId).is('deleted_at', null).order('name')
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

  const barMap = Object.fromEntries(bars.map(b => [b.id, b.name]))

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<StationFormValues>({
    resolver: zodResolver(stationSchema),
  })

  const openAdd = () => { setEditing(null); reset({ name: '', bar_id: '' }); setPanelOpen(true) }
  const openEdit = (s: Station) => { setEditing(s); reset({ name: s.name, bar_id: s.bar_id }); setPanelOpen(true) }

  const saveMutation = useMutation({
    mutationFn: async (values: StationFormValues) => {
      const payload = { organization_id: orgId, venue_id: venueId, bar_id: values.bar_id, name: values.name, updated_by: profile?.id }
      if (editing) {
        const { error } = await supabase.from('stations').update(payload).eq('id', editing.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('stations').insert({ ...payload, created_by: profile?.id })
        if (error) throw error
      }
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['stations', venueId] }); toast.success(editing ? 'Station updated.' : 'Station added.'); setPanelOpen(false) },
    onError: (err: Error) => toast.error(err.message),
  })

  const deleteMutation = useMutation({
    mutationFn: async (s: Station) => {
      const { error } = await supabase.from('stations').update({ deleted_at: new Date().toISOString(), deleted_by: profile?.id }).eq('id', s.id)
      if (error) throw error
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['stations', venueId] }); toast.success('Station deleted.'); setDeleting(null) },
    onError: (err: Error) => toast.error(err.message),
  })

  const columns: Column<Station>[] = [
    { key: 'name', label: 'Station Name', sortable: true },
    { key: 'bar_id', label: 'Bar', sortable: true, render: row => <span className="text-slate-300">{barMap[row.bar_id] ?? '—'}</span> },
    { key: 'active', label: 'Status', render: row => <StatusChip label={row.active ? 'Active' : 'Inactive'} variant={row.active ? 'success' : 'neutral'} size="sm" /> },
  ]

  return (
    <div>
      <SetupPageHeader title="Stations" description="Serving stations within each bar. The finest granularity for event tracking." count={stations.length} onAdd={bars.length > 0 ? openAdd : undefined} addLabel="Add Station" />

      {bars.length === 0 && (
        <div className="mb-4 px-4 py-3 bg-warning/10 border border-warning/20 rounded-xl text-sm text-warning">
          You need at least one bar before adding stations. Go to Setup → Bars first.
        </div>
      )}

      <DataTable columns={columns} data={stations} isLoading={isLoading} emptyTitle="No stations yet" emptyDescription="Add stations like Left Speed Rail, Right Speed Rail, VIP Station, etc." emptyIcon="🎯" onRowClick={openEdit}
        rowActions={row => (
          <div className="flex items-center justify-end gap-1">
            <button onClick={() => openEdit(row)} className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-surface-2 rounded-lg transition-colors"><Pencil size={14} /></button>
            <button onClick={() => setDeleting(row)} className="p-1.5 text-slate-400 hover:text-danger hover:bg-danger/10 rounded-lg transition-colors"><Trash2 size={14} /></button>
          </div>
        )}
      />

      <SlidePanel open={panelOpen} title={editing ? 'Edit Station' : 'Add Station'} description="Stations are the finest granularity for inventory and event tracking." onClose={() => setPanelOpen(false)}>
        <form onSubmit={handleSubmit(v => saveMutation.mutate(v))} noValidate className="space-y-5">
          <Field label="Station name" error={errors.name?.message} required>
            <Input {...register('name')} error={!!errors.name} placeholder="e.g. Left Speed Rail" autoFocus />
          </Field>
          <Field label="Bar" error={errors.bar_id?.message} required>
            <Select {...register('bar_id')} error={!!errors.bar_id} placeholder="Select a bar...">
              {bars.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
          </Field>
          <FormActions onCancel={() => setPanelOpen(false)} isSubmitting={isSubmitting || saveMutation.isPending} submitLabel={editing ? 'Update Station' : 'Add Station'} />
        </form>
      </SlidePanel>

      <ConfirmDialog open={!!deleting} title="Delete station?" description={`"${deleting?.name}" will be deleted. Historical event data is preserved.`} confirmLabel="Delete" variant="danger" onConfirm={() => deleting && deleteMutation.mutate(deleting)} onCancel={() => setDeleting(null)} />
    </div>
  )
}
