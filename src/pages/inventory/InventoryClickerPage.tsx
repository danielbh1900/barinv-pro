import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Minus, Search, Save, RotateCcw, ChevronDown, ChevronUp } from 'lucide-react'
import { supabase } from '@/lib/supabase/client'
import { useVenue } from '@/features/venues/VenueProvider'
import { useAuth } from '@/features/auth/AuthProvider'
import { useToast } from '@/components/ui/Toast'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'
import { enqueue } from '@/lib/offline/queue'
import { processQueue } from '@/lib/offline/sync'
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton'
import { EmptyState } from '@/components/ui/EmptyState'

// ─── Types ───────────────────────────────────────────────────

interface Item    { id: string; name: string; category: string }
interface Unit    { id: string; name: string; abbreviation: string }
interface Bar     { id: string; name: string }

interface CountLine {
  item_id:  string
  unit_id:  string
  quantity: number
}

// ─── Qty stepper ─────────────────────────────────────────────

interface StepperProps {
  value: number
  onChange: (v: number) => void
  step?: number
}

function Stepper({ value, onChange, step = 1 }: StepperProps) {
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => onChange(Math.max(0, parseFloat((value - step).toFixed(3))))}
        className="w-9 h-9 flex items-center justify-center rounded-xl bg-surface-2 hover:bg-surface-3 text-slate-200 transition-colors active:scale-95"
      >
        <Minus size={14} />
      </button>
      <input
        type="number"
        value={value}
        min={0}
        step={step}
        onChange={e => {
          const v = parseFloat(e.target.value)
          if (!isNaN(v) && v >= 0) onChange(v)
        }}
        className="w-16 text-center bg-surface text-slate-100 text-sm font-semibold border border-surface-3 rounded-xl py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
      />
      <button
        type="button"
        onClick={() => onChange(parseFloat((value + step).toFixed(3)))}
        className="w-9 h-9 flex items-center justify-center rounded-xl bg-brand-600 hover:bg-brand-700 text-white transition-colors active:scale-95"
      >
        <Plus size={14} />
      </button>
    </div>
  )
}

// ─── Item row ────────────────────────────────────────────────

interface ItemRowProps {
  item: Item
  units: Unit[]
  line: CountLine | undefined
  onUpdate: (itemId: string, unitId: string, qty: number) => void
}

function ItemRow({ item, units, line, onUpdate }: ItemRowProps) {
  const defaultUnit = units[0]
  const activeUnitId = line?.unit_id ?? defaultUnit?.id ?? ''
  const qty = line?.quantity ?? 0
  const isDirty = qty > 0

  return (
    <div className={`flex items-center justify-between gap-3 px-4 py-3 rounded-xl border transition-colors ${isDirty ? 'bg-brand-600/5 border-brand-500/30' : 'bg-surface-1 border-surface-2'}`}>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-slate-200 truncate">{item.name}</p>
        {units.length > 1 && (
          <select
            value={activeUnitId}
            onChange={e => onUpdate(item.id, e.target.value, qty)}
            className="mt-1 text-xs text-slate-400 bg-transparent border-none focus:outline-none cursor-pointer"
          >
            {units.map(u => <option key={u.id} value={u.id}>{u.abbreviation}</option>)}
          </select>
        )}
        {units.length === 1 && (
          <p className="text-xs text-slate-500 mt-0.5">{defaultUnit?.abbreviation}</p>
        )}
      </div>
      <Stepper
        value={qty}
        onChange={v => onUpdate(item.id, activeUnitId, v)}
        step={0.5}
      />
    </div>
  )
}

// ─── Category section ────────────────────────────────────────

interface CategorySectionProps {
  category: string
  items: Item[]
  units: Unit[]
  lines: Record<string, CountLine>
  onUpdate: (itemId: string, unitId: string, qty: number) => void
}

function CategorySection({ category, items, units, lines, onUpdate }: CategorySectionProps) {
  const [expanded, setExpanded] = useState(true)
  const filledCount = items.filter(i => (lines[i.id]?.quantity ?? 0) > 0).length

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={() => setExpanded(p => !p)}
        className="w-full flex items-center justify-between px-1 py-1.5 text-left"
      >
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider capitalize">{category}</span>
          {filledCount > 0 && (
            <span className="text-xs bg-brand-600/20 text-brand-400 px-1.5 py-0.5 rounded-full">{filledCount}/{items.length}</span>
          )}
        </div>
        {expanded ? <ChevronUp size={14} className="text-slate-500" /> : <ChevronDown size={14} className="text-slate-500" />}
      </button>
      {expanded && (
        <div className="space-y-2">
          {items.map(item => (
            <ItemRow
              key={item.id}
              item={item}
              units={units}
              line={lines[item.id]}
              onUpdate={onUpdate}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Page ────────────────────────────────────────────────────

const CATEGORIES = ['spirit','beer','wine','mixer','garnish','consumable','equipment','other']

export function InventoryClickerPage() {
  const { activeVenue } = useVenue()
  const { profile } = useAuth()
  const toast = useToast()
  const queryClient = useQueryClient()
  const isOnline = useOnlineStatus()

  const orgId   = profile?.organization_id ?? ''
  const venueId = activeVenue?.id ?? ''

  const [search, setSearch]   = useState('')
  const [lines, setLines]     = useState<Record<string, CountLine>>({})
  const [saving, setSaving]   = useState(false)

  // ─── Data ──────────────────────────────────────────────

  const { data: items = [], isLoading: itemsLoading } = useQuery({
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

  const { data: nights = [] } = useQuery({
    queryKey: ['nights-open', venueId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('nights').select('id, night_date')
        .eq('venue_id', venueId).is('close_at', null).limit(1)
      if (error) throw error
      return data
    },
    enabled: !!venueId,
  })

  // ─── Derived ───────────────────────────────────────────

  const filtered = useMemo(() => {
    if (!search.trim()) return items
    const q = search.toLowerCase()
    return items.filter(i => i.name.toLowerCase().includes(q))
  }, [items, search])

  const grouped = useMemo(() => {
    return CATEGORIES.reduce<Record<string, Item[]>>((acc, cat) => {
      const catItems = filtered.filter(i => i.category === cat)
      if (catItems.length > 0) acc[cat] = catItems
      return acc
    }, {})
  }, [filtered])

  const dirtyCount = Object.values(lines).filter(l => l.quantity > 0).length

  // ─── Handlers ──────────────────────────────────────────

  const updateLine = (itemId: string, unitId: string, qty: number) => {
    setLines(prev => ({
      ...prev,
      [itemId]: { item_id: itemId, unit_id: unitId, quantity: qty },
    }))
  }

  const reset = () => {
    setLines({})
    toast.info('Count cleared.')
  }

  const save = async () => {
    const activeNight = nights[0]
    if (!activeNight) {
      toast.error('No open night. Open a night in Operations → Nights first.')
      return
    }

    const nonZero = Object.values(lines).filter(l => l.quantity > 0)
    if (nonZero.length === 0) {
      toast.error('Nothing to save — all quantities are zero.')
      return
    }

    setSaving(true)

    try {
      // Create count session
      const sessionPayload = {
        organization_id: orgId,
        venue_id:        venueId,
        night_id:        activeNight.id,
        status:          'submitted',
        label:           `Inventory count ${new Date().toLocaleTimeString()}`,
        started_at:      new Date().toISOString(),
        submitted_at:    new Date().toISOString(),
        created_by:      profile?.id,
        updated_by:      profile?.id,
        client_operation_id: crypto.randomUUID(),
      }

      if (isOnline) {
        const { data: session, error: sessionError } = await supabase
          .from('count_sessions').insert(sessionPayload).select('id').single()
        if (sessionError) throw sessionError

        // Insert count entries
        const entries = nonZero.map(line => ({
          organization_id:  orgId,
          venue_id:         venueId,
          count_session_id: session.id,
          item_id:          line.item_id,
          unit_id:          line.unit_id,
          counted_quantity: line.quantity,
          counted_by:       profile?.id,
        }))

        const { error: entriesError } = await supabase.from('count_entries').insert(entries)
        if (entriesError) throw entriesError

        toast.success(`Count saved — ${nonZero.length} items recorded.`)
        queryClient.invalidateQueries({ queryKey: ['count_sessions', venueId] })
      } else {
        // Offline: queue session + entries
        for (const line of nonZero) {
          await enqueue('count_entry', 'count_entries', {
            organization_id:  orgId,
            venue_id:         venueId,
            night_id:         activeNight.id,
            item_id:          line.item_id,
            unit_id:          line.unit_id,
            counted_quantity: line.quantity,
            counted_by:       profile?.id,
          })
        }
        toast.success(`${nonZero.length} count entries queued — will sync when online.`)
        processQueue()
      }

      setLines({})
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save count.')
    } finally {
      setSaving(false)
    }
  }

  // ─── Render ────────────────────────────────────────────

  return (
    <div className="max-w-lg mx-auto space-y-4">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-100">Inventory Clicker</h1>
          <p className="text-sm text-slate-400 mt-0.5">{activeVenue?.name}</p>
        </div>
        {dirtyCount > 0 && (
          <span className="text-xs bg-brand-600/20 text-brand-400 px-2.5 py-1 rounded-full font-medium">
            {dirtyCount} counted
          </span>
        )}
      </div>

      {/* No open night warning */}
      {nights.length === 0 && (
        <div className="px-4 py-3 bg-warning/10 border border-warning/20 rounded-xl text-sm text-warning">
          No open night. Open a night in Operations → Nights before counting.
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search items..."
          className="w-full pl-10 pr-4 py-2.5 bg-surface-1 border border-surface-2 rounded-xl text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
        />
      </div>

      {/* Items */}
      {itemsLoading && <LoadingSkeleton variant="row" rows={6} />}

      {!itemsLoading && items.length === 0 && (
        <EmptyState icon="📦" title="No items" description="Add items in Setup → Items first." />
      )}

      {!itemsLoading && items.length > 0 && (
        <div className="space-y-4">
          {Object.entries(grouped).map(([cat, catItems]) => (
            <CategorySection
              key={cat}
              category={cat}
              items={catItems}
              units={units}
              lines={lines}
              onUpdate={updateLine}
            />
          ))}
          {Object.keys(grouped).length === 0 && search && (
            <p className="text-center text-sm text-slate-400 py-8">No items match "{search}"</p>
          )}
        </div>
      )}

      {/* Action bar — sticky on mobile */}
      {dirtyCount > 0 && (
        <div className="sticky bottom-4 flex gap-2 pt-2">
          <button
            type="button"
            onClick={reset}
            className="flex items-center gap-2 px-4 py-3 rounded-2xl bg-surface-2 hover:bg-surface-3 text-slate-300 text-sm font-medium transition-colors"
          >
            <RotateCcw size={15} />
            Reset
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-2xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold transition-colors disabled:opacity-50"
          >
            {saving
              ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              : <Save size={16} />
            }
            {saving ? 'Saving...' : `Save ${dirtyCount} ${dirtyCount === 1 ? 'item' : 'items'}`}
          </button>
        </div>
      )}
    </div>
  )
}
