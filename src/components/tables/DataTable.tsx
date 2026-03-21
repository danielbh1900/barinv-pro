import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react'
import { useState } from 'react'
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton'
import { EmptyState } from '@/components/ui/EmptyState'

export interface Column<T> {
  key: keyof T | string
  label: string
  sortable?: boolean
  width?: string
  render?: (row: T) => React.ReactNode
}

interface DataTableProps<T extends { id: string }> {
  columns: Column<T>[]
  data: T[]
  isLoading?: boolean
  emptyTitle?: string
  emptyDescription?: string
  emptyIcon?: string
  onRowClick?: (row: T) => void
  rowActions?: (row: T) => React.ReactNode
}

export function DataTable<T extends { id: string }>({
  columns,
  data,
  isLoading = false,
  emptyTitle = 'No records found',
  emptyDescription,
  emptyIcon,
  onRowClick,
  rowActions,
}: DataTableProps<T>) {
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir(prev => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  const sorted = [...data].sort((a, b) => {
    if (!sortKey) return 0
    const aVal = (a as Record<string, unknown>)[sortKey]
    const bVal = (b as Record<string, unknown>)[sortKey]
    if (aVal == null) return 1
    if (bVal == null) return -1
    const cmp = String(aVal).localeCompare(String(bVal), undefined, { numeric: true })
    return sortDir === 'asc' ? cmp : -cmp
  })

  if (isLoading) return <LoadingSkeleton variant="row" rows={5} />

  if (data.length === 0) {
    return <EmptyState icon={emptyIcon} title={emptyTitle} description={emptyDescription} />
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-surface-2">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-surface-2 bg-surface-1">
            {columns.map(col => (
              <th
                key={String(col.key)}
                className={`px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider ${col.width ?? ''} ${col.sortable ? 'cursor-pointer select-none hover:text-slate-200 transition-colors' : ''}`}
                onClick={() => col.sortable && handleSort(String(col.key))}
              >
                <span className="flex items-center gap-1">
                  {col.label}
                  {col.sortable && (
                    sortKey === String(col.key)
                      ? sortDir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />
                      : <ChevronsUpDown size={12} className="opacity-30" />
                  )}
                </span>
              </th>
            ))}
            {rowActions && (
              <th className="px-4 py-3 text-right text-xs font-semibold text-slate-400 uppercase tracking-wider w-20">Actions</th>
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-surface-2">
          {sorted.map(row => (
            <tr
              key={row.id}
              onClick={() => onRowClick?.(row)}
              className={`bg-surface-1 transition-colors ${onRowClick ? 'cursor-pointer hover:bg-surface-2' : ''}`}
            >
              {columns.map(col => (
                <td key={String(col.key)} className="px-4 py-3 text-slate-200">
                  {col.render
                    ? col.render(row)
                    : String((row as Record<string, unknown>)[String(col.key)] ?? '—')}
                </td>
              ))}
              {rowActions && (
                <td className="px-4 py-3 text-right" onClick={e => e.stopPropagation()}>
                  {rowActions(row)}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
