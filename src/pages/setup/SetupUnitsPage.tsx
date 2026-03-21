import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Pencil, Trash2 } from 'lucide-react'
import { supabase } from '@/lib/supabase/client'
import { useAuth } from '@/features/auth/AuthProvider'
import { useToast } from '@/components/ui/Toast'
import { DataTable, type Column } from '@/components/tables/DataTable'
import { SlidePanel } from '@/components/ui/SlidePanel'
import { SetupPageHeader } from '@/components/ui/SetupPageHeader'
import { Field, Input, FormActions } from '@/components/forms/Fields'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { StatusChip } from '@/components/ui/StatusChip'

interface Unit {
  id: string
  name: string
  abbreviation: string
  base_ml: number | null
  active: boolean
  created_at: string
}

const unitSchema = z.object({
  name: z.string().min(1, 'Name is required').max(80),
  abbreviation: z.string().min(1, 'Abbreviation is required').max(20),
  base_ml: z.string().optional().transform(v => (v ? parseFloat(v) : null)),
})

type UnitFormValues = z.infer<typeof unitSchema>

export function SetupUnitsPage() {
  const { profile } = useAuth()
  const toast = useToast()
  const queryClient = useQueryClient()
  const orgId = profile?.organization_id ?? ''

  const [panelOpen, setPanelOpen] = useState(false)
  const [editing, setEditing] = useState<Unit | null>(null)
  const [deleting, setDeleting] = useState<Unit | null>(null)

  const { data: units = [], isLoading } = useQuery({
    queryKey: ['units', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('units').select('*')
        .eq('organization_id', orgId).order('name')
      if (error) throw error
      return data as Unit[]
    },
    enabled: !!orgId,
  })

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<UnitFormValues>({
    resolver: zodResolver(unitSchema),
  })

  const openAdd = () => {
    setEditing(null)
    reset({ name: '', abbreviation: '', base_ml: undefined })
    setPanelOpen(true)
  }

  const openEdit = (unit: Unit) => {
    setEditing(unit)
    reset({ name: unit.name, abbreviation: unit.abbreviation, base_ml: unit.base_ml != null ? String(unit.base_ml) : undefined })
    setPanelOpen(true)
  }

  const saveMutation = useMutation({
    mutationFn: async (values: UnitFormValues) => {
      const payload = { organization_id: orgId, name: values.name, abbreviation: values.abbreviation, base_ml: values.base_ml ?? null, updated_by: profile?.id }
      if (editing) {
        const { error } = await supabase.from('units').update(payload).eq('id', editing.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('units').insert({ ...payload, created_by: profile?.id })
        if (error) throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['units', orgId] })
      toast.success(editing ? 'Unit updated.' : 'Unit added.')
      setPanelOpen(false)
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const deleteMutation = useMutation({
    mutationFn: async (unit: Unit) => {
      const { error } = await supabase.from('units').update({ active: false, updated_by: profile?.id }).eq('id', unit.id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['units', orgId] })
      toast.success('Unit deactivated.')
      setDeleting(null)
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const columns: Column<Unit>[] = [
    { key: 'name', label: 'Name', sortable: true },
    { key: 'abbreviation', label: 'Abbrev.', sortable: true,
      render: row => <span className="font-mono text-xs bg-surface-2 px-2 py-0.5 rounded text-slate-300">{row.abbreviation}</span> },
    { key: 'base_ml', label: 'Base ml',
      render: row => <span className="text-slate-400">{row.base_ml != null ? `${row.base_ml} ml` : '—'}</span> },
    { key: 'active', label: 'Status',
      render: row => <StatusChip label={row.active ? 'Active' : 'Inactive'} variant={row.active ? 'success' : 'neutral'} size="sm" /> },
  ]

  return (
    <div>
      <SetupPageHeader title="Units of Measure" description="Measurement units used across inventory and events." count={units.length} onAdd={openAdd} addLabel="Add Unit" />

      <DataTable columns={columns} data={units} isLoading={isLoading} emptyTitle="No units yet" emptyDescription="Add units like Bottle 750ml, Case 12, Keg, etc." emptyIcon="📏" onRowClick={openEdit}
        rowActions={row => (
          <div className="flex items-center justify-end gap-1">
            <button onClick={() => openEdit(row)} className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-surface-2 rounded-lg transition-colors"><Pencil size={14} /></button>
            <button onClick={() => setDeleting(row)} className="p-1.5 text-slate-400 hover:text-danger hover:bg-danger/10 rounded-lg transition-colors"><Trash2 size={14} /></button>
          </div>
        )}
      />

      <SlidePanel open={panelOpen} title={editing ? 'Edit Unit' : 'Add Unit'} description="Units define how stock is measured and tracked." onClose={() => setPanelOpen(false)}>
        <form onSubmit={handleSubmit(v => saveMutation.mutate(v))} noValidate className="space-y-5">
          <Field label="Name" error={errors.name?.message} required>
            <Input {...register('name')} error={!!errors.name} placeholder="e.g. Bottle 750ml" autoFocus />
          </Field>
          <Field label="Abbreviation" error={errors.abbreviation?.message} hint="Short label shown in tables." required>
            <Input {...register('abbreviation')} error={!!errors.abbreviation} placeholder="e.g. 750ml" />
          </Field>
          <Field label="Base volume (ml)" hint="Optional. Used for cross-unit calculations.">
            <Input {...register('base_ml')} type="number" inputMode="decimal" min="0" step="0.001" placeholder="e.g. 750" />
          </Field>
          <FormActions onCancel={() => setPanelOpen(false)} isSubmitting={isSubmitting || saveMutation.isPending} submitLabel={editing ? 'Update Unit' : 'Add Unit'} />
        </form>
      </SlidePanel>

      <ConfirmDialog open={!!deleting} title="Deactivate unit?" description={`"${deleting?.name}" will be deactivated. Existing data is preserved.`} confirmLabel="Deactivate" variant="warning" onConfirm={() => deleting && deleteMutation.mutate(deleting)} onCancel={() => setDeleting(null)} />
    </div>
  )
}
