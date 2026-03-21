import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Pencil, UserX } from 'lucide-react'
import { supabase } from '@/lib/supabase/client'
import { useVenue } from '@/features/venues/VenueProvider'
import { useAuth } from '@/features/auth/AuthProvider'
import { useToast } from '@/components/ui/Toast'
import { DataTable, type Column } from '@/components/tables/DataTable'
import { SlidePanel } from '@/components/ui/SlidePanel'
import { SetupPageHeader } from '@/components/ui/SetupPageHeader'
import { Field, Select, FormActions } from '@/components/forms/Fields'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { StatusChip } from '@/components/ui/StatusChip'
import type { UserRole } from '@/types'

const ROLES: UserRole[] = ['owner','admin','co_admin','manager','finance','bartender','barback','door','promoter']

interface StaffRow {
  id: string
  user_id: string
  role: UserRole
  active: boolean
  created_at: string
  profiles: {
    id: string
    full_name: string
    display_name: string | null
  } | null
}

const staffSchema = z.object({
  role: z.enum(ROLES as [UserRole, ...UserRole[]]),
})

type StaffFormValues = z.infer<typeof staffSchema>

export function SetupStaffPage() {
  const { activeVenue } = useVenue()
  const { profile } = useAuth()
  const toast = useToast()
  const queryClient = useQueryClient()
  const orgId = profile?.organization_id ?? ''
  const venueId = activeVenue?.id ?? ''

  const [panelOpen, setPanelOpen] = useState(false)
  const [editing, setEditing] = useState<StaffRow | null>(null)
  const [deactivating, setDeactivating] = useState<StaffRow | null>(null)

  const { data: staff = [], isLoading } = useQuery({
    queryKey: ['venue_users', venueId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('venue_users')
        .select('id, user_id, role, active, created_at, profiles(id, full_name, display_name)')
        .eq('venue_id', venueId)
        .order('created_at')
      if (error) throw error
      return data as StaffRow[]
    },
    enabled: !!venueId,
  })

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<StaffFormValues>({
    resolver: zodResolver(staffSchema),
  })

  const openEdit = (row: StaffRow) => {
    setEditing(row)
    reset({ role: row.role })
    setPanelOpen(true)
  }

  const updateRoleMutation = useMutation({
    mutationFn: async (values: StaffFormValues) => {
      if (!editing) return
      const { error } = await supabase
        .from('venue_users')
        .update({ role: values.role, updated_by: profile?.id })
        .eq('id', editing.id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['venue_users', venueId] })
      toast.success('Role updated.')
      setPanelOpen(false)
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const deactivateMutation = useMutation({
    mutationFn: async (row: StaffRow) => {
      const { error } = await supabase
        .from('venue_users')
        .update({ active: false, updated_by: profile?.id })
        .eq('id', row.id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['venue_users', venueId] })
      toast.success('Staff member deactivated.')
      setDeactivating(null)
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const columns: Column<StaffRow>[] = [
    { key: 'user_id', label: 'Name',
      render: row => (
        <div>
          <p className="text-slate-200 text-sm font-medium">{row.profiles?.full_name ?? 'Unknown'}</p>
          {row.profiles?.display_name && <p className="text-slate-500 text-xs">{row.profiles.display_name}</p>}
        </div>
      ),
    },
    { key: 'role', label: 'Role', sortable: true,
      render: row => <span className="capitalize text-slate-300">{row.role.replace('_', ' ')}</span> },
    { key: 'active', label: 'Status',
      render: row => <StatusChip label={row.active ? 'Active' : 'Inactive'} variant={row.active ? 'success' : 'neutral'} size="sm" /> },
    { key: 'created_at', label: 'Added',
      render: row => <span className="text-slate-400 text-xs">{new Date(row.created_at).toLocaleDateString()}</span> },
  ]

  return (
    <div>
      <SetupPageHeader title="Staff" description={`Staff assigned to ${activeVenue?.name ?? 'this venue'}.`} count={staff.length} />

      <div className="mb-4 px-4 py-3 bg-info/5 border border-info/20 rounded-xl text-sm text-slate-400">
        To add new staff members, invite them via Supabase Auth and assign them to this venue. Role changes are audited.
      </div>

      <DataTable columns={columns} data={staff} isLoading={isLoading} emptyTitle="No staff assigned" emptyDescription="Staff members will appear here once they are assigned to this venue." emptyIcon="👥" onRowClick={openEdit}
        rowActions={row => (
          <div className="flex items-center justify-end gap-1">
            <button onClick={() => openEdit(row)} className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-surface-2 rounded-lg transition-colors" title="Change role"><Pencil size={14} /></button>
            <button onClick={() => setDeactivating(row)} className="p-1.5 text-slate-400 hover:text-danger hover:bg-danger/10 rounded-lg transition-colors" title="Deactivate"><UserX size={14} /></button>
          </div>
        )}
      />

      <SlidePanel open={panelOpen} title="Change Role" description={`Updating role for ${editing?.profiles?.full_name}. This action is audited.`} onClose={() => setPanelOpen(false)}>
        <form onSubmit={handleSubmit(v => updateRoleMutation.mutate(v))} noValidate className="space-y-5">
          <Field label="Role" error={errors.role?.message} required>
            <Select {...register('role')} error={!!errors.role}>
              {ROLES.map(r => (
                <option key={r} value={r} className="capitalize">{r.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase())}</option>
              ))}
            </Select>
          </Field>
          <FormActions onCancel={() => setPanelOpen(false)} isSubmitting={isSubmitting || updateRoleMutation.isPending} submitLabel="Update Role" />
        </form>
      </SlidePanel>

      <ConfirmDialog open={!!deactivating} title="Deactivate staff member?" description={`${deactivating?.profiles?.full_name} will lose access to this venue.`} confirmLabel="Deactivate" variant="warning" onConfirm={() => deactivating && deactivateMutation.mutate(deactivating)} onCancel={() => setDeactivating(null)} />
    </div>
  )
}
