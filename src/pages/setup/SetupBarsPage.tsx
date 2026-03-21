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
import { Field, Input, FormActions } from '@/components/forms/Fields'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { StatusChip } from '@/components/ui/StatusChip'

interface Bar {
  id: string
  name: string
  active: boolean
  deleted_at: string | null
  created_at: string
}

const barSchema = z.object({
  name: z.string().min(1, 'Name is required').max(80),
})

type BarFormValues = z.infer<typeof barSchema>

export function SetupBarsPage() {
  const { activeVenue } = useVenue()
  const { profile } = useAuth()
  const toast = useToast()
  const queryClient = useQueryClient()
  const orgId = profile?.organization_id ?? ''
  const venueId = activeVenue?.id ?? ''

  const [panelOpen, setPanelOpen] = useState(false)
  const [editing, setEditing] = useState<Bar | null>(null)
  const [deleting, setDeleting] = useState<Bar | null>(null)

  const { data: bars = [], isLoading } = useQuery({
    queryKey: ['bars', venueId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bars').select('*')
        .eq('venue_id', venueId)
        .is('deleted_at', null)
        .order('name')
      if (error) throw error
      return data as Bar[]
    },
    enabled: !!venueId,
  })

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<BarFormValues>({
    resolver: zodResolver(barSchema),
  })

  const openAdd = () => { setEditing(null); reset({ name: '' }); setPanelOpen(true) }
  const openEdit = (bar: Bar) => { setEditing(bar); reset({ name: bar.name }); setPanelOpen(true) }

  const saveMutation = useMutation({
    mutationFn: async (values: BarFormValues) => {
      const payload = { organization_id: orgId, venue_id: venueId, name: values.name, updated_by: profile?.id }
      if (editing) {
        const { error } = await supabase.from('bars').update(payload).eq('id', editing.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('bars').insert({ ...payload, created_by: profile?.id })
        if (error) throw error
      }
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['bars', venueId] }); toast.success(editing ? 'Bar updated.' : 'Bar added.'); setPanelOpen(false) },
    onError: (err: Error) => toast.error(err.message),
  })

  const deleteMutation = useMutation({
    mutationFn: async (bar: Bar) => {
      const { error } = await supabase.from('bars').update({ deleted_at: new Date().toISOString(), deleted_by: profile?.id }).eq('id', bar.id)
      if (error) throw error
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['bars', venueId] }); toast.success('Bar deleted.'); setDeleting(null) },
    onError: (err: Error) => toast.error(err.message),
  })

  const columns: Column<Bar>[] = [
    { key: 'name', label: 'Bar Name', sortable: true },
    { key: 'active', label: 'Status', render: row => <StatusChip label={row.active ? 'Active' : 'Inactive'} variant={row.active ? 'success' : 'neutral'} size="sm" /> },
    { key: 'created_at', label: 'Added', render: row => <span className="text-slate-400 text-xs">{new Date(row.created_at).toLocaleDateString()}</span> },
  ]

  return (
    <div>
      <SetupPageHeader title="Bars" description={`Physical bar areas at ${activeVenue?.name ?? 'this venue'}.`} count={bars.length} onAdd={openAdd} addLabel="Add Bar" />

      <DataTable columns={columns} data={bars} isLoading={isLoading} emptyTitle="No bars yet" emptyDescription="Add bar areas like Main Bar, VIP Bar, Patio, etc." emptyIcon="🍸" onRowClick={openEdit}
        rowActions={row => (
          <div className="flex items-center justify-end gap-1">
            <button onClick={() => openEdit(row)} className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-surface-2 rounded-lg transition-colors"><Pencil size={14} /></button>
            <button onClick={() => setDeleting(row)} className="p-1.5 text-slate-400 hover:text-danger hover:bg-danger/10 rounded-lg transition-colors"><Trash2 size={14} /></button>
          </div>
        )}
      />

      <SlidePanel open={panelOpen} title={editing ? 'Edit Bar' : 'Add Bar'} description="A bar is a physical area within the venue." onClose={() => setPanelOpen(false)}>
        <form onSubmit={handleSubmit(v => saveMutation.mutate(v))} noValidate className="space-y-5">
          <Field label="Bar name" error={errors.name?.message} required>
            <Input {...register('name')} error={!!errors.name} placeholder="e.g. Main Bar" autoFocus />
          </Field>
          <FormActions onCancel={() => setPanelOpen(false)} isSubmitting={isSubmitting || saveMutation.isPending} submitLabel={editing ? 'Update Bar' : 'Add Bar'} />
        </form>
      </SlidePanel>

      <ConfirmDialog open={!!deleting} title="Delete bar?" description={`"${deleting?.name}" will be deleted. Stations under this bar must be reassigned first.`} confirmLabel="Delete" variant="danger" onConfirm={() => deleting && deleteMutation.mutate(deleting)} onCancel={() => setDeleting(null)} />
    </div>
  )
}
