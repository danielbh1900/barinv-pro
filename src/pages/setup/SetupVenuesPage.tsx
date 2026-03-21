import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Pencil } from 'lucide-react'
import { supabase } from '@/lib/supabase/client'
import { useAuth } from '@/features/auth/AuthProvider'
import { useToast } from '@/components/ui/Toast'
import { DataTable, type Column } from '@/components/tables/DataTable'
import { SlidePanel } from '@/components/ui/SlidePanel'
import { SetupPageHeader } from '@/components/ui/SetupPageHeader'
import { Field, Input, FormActions } from '@/components/forms/Fields'
import { StatusChip } from '@/components/ui/StatusChip'
import type { Venue } from '@/types'

// Common IANA timezones for hospitality use
const TIMEZONES = [
  'America/Vancouver','America/Toronto','America/New_York','America/Chicago',
  'America/Denver','America/Los_Angeles','America/Phoenix',
  'Europe/London','Europe/Paris','Europe/Berlin','Europe/Dubai',
  'Asia/Dubai','Asia/Riyadh','Asia/Tehran',
  'Australia/Sydney','Pacific/Auckland',
]

const venueSchema = z.object({
  name: z.string().min(1, 'Name is required').max(120),
  slug: z.string().min(1, 'Slug is required').max(60).regex(/^[a-z0-9-]+$/, 'Lowercase letters, numbers and hyphens only'),
  timezone: z.string().min(1, 'Timezone is required'),
  address: z.string().optional(),
})

type VenueFormValues = z.infer<typeof venueSchema>

export function SetupVenuesPage() {
  const { profile } = useAuth()
  const toast = useToast()
  const queryClient = useQueryClient()
  const orgId = profile?.organization_id ?? ''

  const [panelOpen, setPanelOpen] = useState(false)
  const [editing, setEditing] = useState<Venue | null>(null)

  const { data: venues = [], isLoading } = useQuery({
    queryKey: ['venues', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('venues').select('*')
        .eq('organization_id', orgId).order('name')
      if (error) throw error
      return data as Venue[]
    },
    enabled: !!orgId,
  })

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<VenueFormValues>({
    resolver: zodResolver(venueSchema),
  })

  const openAdd = () => { setEditing(null); reset({ name: '', slug: '', timezone: 'America/Vancouver', address: '' }); setPanelOpen(true) }
  const openEdit = (v: Venue) => { setEditing(v); reset({ name: v.name, slug: v.slug, timezone: v.timezone, address: v.address ?? '' }); setPanelOpen(true) }

  const saveMutation = useMutation({
    mutationFn: async (values: VenueFormValues) => {
      const payload = { organization_id: orgId, name: values.name, slug: values.slug, timezone: values.timezone, address: values.address || null }
      if (editing) {
        const { error } = await supabase.from('venues').update(payload).eq('id', editing.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('venues').insert(payload)
        if (error) throw error
      }
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['venues', orgId] }); toast.success(editing ? 'Venue updated.' : 'Venue added.'); setPanelOpen(false) },
    onError: (err: Error) => toast.error(err.message),
  })

  const columns: Column<Venue>[] = [
    { key: 'name', label: 'Venue Name', sortable: true },
    { key: 'timezone', label: 'Timezone', render: row => <span className="font-mono text-xs text-slate-400">{row.timezone}</span> },
    { key: 'address', label: 'Address', render: row => <span className="text-slate-400 text-sm">{row.address ?? '—'}</span> },
    { key: 'active', label: 'Status', render: row => <StatusChip label={row.active ? 'Active' : 'Inactive'} variant={row.active ? 'success' : 'neutral'} size="sm" /> },
  ]

  return (
    <div>
      <SetupPageHeader title="Venues" description="Manage venues within your organization." count={venues.length} onAdd={openAdd} addLabel="Add Venue" />

      <DataTable columns={columns} data={venues} isLoading={isLoading} emptyTitle="No venues yet" emptyDescription="Add your first venue to get started." emptyIcon="🏢" onRowClick={openEdit}
        rowActions={row => (
          <button onClick={() => openEdit(row)} className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-surface-2 rounded-lg transition-colors"><Pencil size={14} /></button>
        )}
      />

      <SlidePanel open={panelOpen} title={editing ? 'Edit Venue' : 'Add Venue'} onClose={() => setPanelOpen(false)}>
        <form onSubmit={handleSubmit(v => saveMutation.mutate(v))} noValidate className="space-y-5">
          <Field label="Venue name" error={errors.name?.message} required>
            <Input {...register('name')} error={!!errors.name} placeholder="e.g. The Harbor Club" autoFocus />
          </Field>
          <Field label="Slug" error={errors.slug?.message} hint="URL-safe identifier. Lowercase letters, numbers, hyphens only." required>
            <Input {...register('slug')} error={!!errors.slug} placeholder="e.g. harbor-club" />
          </Field>
          <Field label="Timezone" error={errors.timezone?.message} hint="All timestamps are stored in UTC and displayed in this timezone." required>
            <select {...register('timezone')} className="w-full px-4 py-2.5 rounded-xl bg-surface text-slate-100 text-sm border border-surface-3 focus:outline-none focus:ring-2 focus:ring-brand-500">
              {TIMEZONES.map(tz => <option key={tz} value={tz}>{tz}</option>)}
            </select>
          </Field>
          <Field label="Address" hint="Optional.">
            <Input {...register('address')} placeholder="e.g. 123 Main St, Vancouver, BC" />
          </Field>
          <FormActions onCancel={() => setPanelOpen(false)} isSubmitting={isSubmitting || saveMutation.isPending} submitLabel={editing ? 'Update Venue' : 'Add Venue'} />
        </form>
      </SlidePanel>
    </div>
  )
}
