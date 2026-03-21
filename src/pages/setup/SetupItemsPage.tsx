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
import { Field, Input, Select, FormActions } from '@/components/forms/Fields'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { StatusChip } from '@/components/ui/StatusChip'

const CATEGORIES = ['spirit', 'beer', 'wine', 'mixer', 'garnish', 'consumable', 'equipment', 'other'] as const
type ItemCategory = typeof CATEGORIES[number]

interface Item {
  id: string
  name: string
  sku: string | null
  category: ItemCategory
  default_unit_id: string
  current_cost: number | null
  current_cost_currency: string
  active: boolean
  deleted_at: string | null
  created_at: string
}

interface Unit { id: string; name: string; abbreviation: string }

const itemSchema = z.object({
  name: z.string().min(1, 'Name is required').max(120),
  sku: z.string().max(80).optional().or(z.literal('')),
  category: z.enum(CATEGORIES),
  default_unit_id: z.string().min(1, 'Default unit is required'),
  current_cost: z.string().optional().transform(v => (v ? parseFloat(v) : null)),
  current_cost_currency: z.string().default('CAD'),
})

type ItemFormValues = z.infer<typeof itemSchema>

export function SetupItemsPage() {
  const { profile } = useAuth()
  const toast = useToast()
  const queryClient = useQueryClient()
  const orgId = profile?.organization_id ?? ''

  const [panelOpen, setPanelOpen] = useState(false)
  const [editing, setEditing] = useState<Item | null>(null)
  const [deleting, setDeleting] = useState<Item | null>(null)

  const { data: items = [], isLoading } = useQuery({
    queryKey: ['items', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('items').select('*')
        .eq('organization_id', orgId)
        .is('deleted_at', null)
        .order('name')
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

  const unitMap = Object.fromEntries(units.map(u => [u.id, u]))

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<ItemFormValues>({
    resolver: zodResolver(itemSchema),
  })

  const openAdd = () => {
    setEditing(null)
    reset({ name: '', sku: '', category: 'spirit', default_unit_id: '', current_cost: undefined, current_cost_currency: 'CAD' })
    setPanelOpen(true)
  }

  const openEdit = (item: Item) => {
    setEditing(item)
    reset({ name: item.name, sku: item.sku ?? '', category: item.category, default_unit_id: item.default_unit_id, current_cost: item.current_cost != null ? String(item.current_cost) : undefined, current_cost_currency: item.current_cost_currency })
    setPanelOpen(true)
  }

  const saveMutation = useMutation({
    mutationFn: async (values: ItemFormValues) => {
      const payload = {
        organization_id: orgId,
        name: values.name,
        sku: values.sku || null,
        category: values.category,
        default_unit_id: values.default_unit_id,
        current_cost: values.current_cost ?? null,
        current_cost_currency: values.current_cost_currency,
        updated_by: profile?.id,
      }
      if (editing) {
        const { error } = await supabase.from('items').update(payload).eq('id', editing.id)
        if (error) throw error
        // If cost changed, create cost_snapshot
        if (editing.current_cost !== values.current_cost && values.current_cost != null) {
          await supabase.from('cost_snapshots').insert({
            organization_id: orgId,
            item_id: editing.id,
            unit_id: values.default_unit_id,
            cost: values.current_cost,
            currency: values.current_cost_currency,
            source: 'manual',
            created_by: profile?.id,
          })
        }
      } else {
        const { data: inserted, error } = await supabase
          .from('items').insert({ ...payload, created_by: profile?.id }).select('id').single()
        if (error) throw error
        // Create initial cost snapshot
        if (values.current_cost != null && inserted) {
          await supabase.from('cost_snapshots').insert({
            organization_id: orgId,
            item_id: inserted.id,
            unit_id: values.default_unit_id,
            cost: values.current_cost,
            currency: values.current_cost_currency,
            source: 'manual',
            created_by: profile?.id,
          })
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['items', orgId] })
      toast.success(editing ? 'Item updated.' : 'Item added.')
      setPanelOpen(false)
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const deleteMutation = useMutation({
    mutationFn: async (item: Item) => {
      const { error } = await supabase.from('items').update({ deleted_at: new Date().toISOString(), deleted_by: profile?.id }).eq('id', item.id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['items', orgId] })
      toast.success('Item deleted.')
      setDeleting(null)
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const columns: Column<Item>[] = [
    { key: 'name', label: 'Name', sortable: true },
    { key: 'category', label: 'Category', sortable: true,
      render: row => <span className="capitalize text-slate-300">{row.category}</span> },
    { key: 'default_unit_id', label: 'Default Unit',
      render: row => <span className="text-slate-400">{unitMap[row.default_unit_id]?.abbreviation ?? '—'}</span> },
    { key: 'current_cost', label: 'Cost',
      render: row => <span className="text-slate-300">{row.current_cost != null ? `${row.current_cost_currency} ${row.current_cost.toFixed(2)}` : '—'}</span> },
    { key: 'sku', label: 'SKU',
      render: row => <span className="font-mono text-xs text-slate-400">{row.sku ?? '—'}</span> },
    { key: 'active', label: 'Status',
      render: row => <StatusChip label={row.active ? 'Active' : 'Inactive'} variant={row.active ? 'success' : 'neutral'} size="sm" /> },
  ]

  return (
    <div>
      <SetupPageHeader title="Items" description="Master product catalogue shared across all venues." count={items.length} onAdd={openAdd} addLabel="Add Item" />

      <DataTable columns={columns} data={items} isLoading={isLoading} emptyTitle="No items yet" emptyDescription="Add spirits, beer, wine, mixers, and other products." emptyIcon="🍾" onRowClick={openEdit}
        rowActions={row => (
          <div className="flex items-center justify-end gap-1">
            <button onClick={() => openEdit(row)} className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-surface-2 rounded-lg transition-colors"><Pencil size={14} /></button>
            <button onClick={() => setDeleting(row)} className="p-1.5 text-slate-400 hover:text-danger hover:bg-danger/10 rounded-lg transition-colors"><Trash2 size={14} /></button>
          </div>
        )}
      />

      <SlidePanel open={panelOpen} title={editing ? 'Edit Item' : 'Add Item'} onClose={() => setPanelOpen(false)}>
        <form onSubmit={handleSubmit(v => saveMutation.mutate(v))} noValidate className="space-y-5">
          <Field label="Name" error={errors.name?.message} required>
            <Input {...register('name')} error={!!errors.name} placeholder="e.g. Hendricks Gin 750ml" autoFocus />
          </Field>
          <Field label="Category" error={errors.category?.message} required>
            <Select {...register('category')} error={!!errors.category}>
              {CATEGORIES.map(c => <option key={c} value={c} className="capitalize">{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
            </Select>
          </Field>
          <Field label="Default unit" error={errors.default_unit_id?.message} required>
            <Select {...register('default_unit_id')} error={!!errors.default_unit_id} placeholder="Select a unit...">
              {units.map(u => <option key={u.id} value={u.id}>{u.name} ({u.abbreviation})</option>)}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Unit cost" hint="Optional.">
              <Input {...register('current_cost')} type="number" inputMode="decimal" min="0" step="0.01" placeholder="0.00" />
            </Field>
            <Field label="Currency">
              <Select {...register('current_cost_currency')}>
                {['CAD','USD','GBP','EUR','AED'].map(c => <option key={c} value={c}>{c}</option>)}
              </Select>
            </Field>
          </div>
          <Field label="SKU / Barcode" hint="Optional internal reference or barcode.">
            <Input {...register('sku')} placeholder="e.g. 0080686000020" />
          </Field>
          <FormActions onCancel={() => setPanelOpen(false)} isSubmitting={isSubmitting || saveMutation.isPending} submitLabel={editing ? 'Update Item' : 'Add Item'} />
        </form>
      </SlidePanel>

      <ConfirmDialog open={!!deleting} title="Delete item?" description={`"${deleting?.name}" will be soft-deleted. Historical records are preserved.`} confirmLabel="Delete" variant="danger" onConfirm={() => deleting && deleteMutation.mutate(deleting)} onCancel={() => setDeleting(null)} />
    </div>
  )
}
