import { Plus } from 'lucide-react'

interface SetupPageHeaderProps {
  title: string
  description?: string
  count?: number
  onAdd?: () => void
  addLabel?: string
}

export function SetupPageHeader({
  title,
  description,
  count,
  onAdd,
  addLabel = 'Add',
}: SetupPageHeaderProps) {
  return (
    <div className="flex items-start justify-between gap-4 mb-6">
      <div>
        <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2">
          {title}
          {count !== undefined && (
            <span className="text-sm font-medium text-slate-500 bg-surface-2 px-2 py-0.5 rounded-full">
              {count}
            </span>
          )}
        </h1>
        {description && (
          <p className="text-sm text-slate-400 mt-0.5">{description}</p>
        )}
      </div>
      {onAdd && (
        <button
          onClick={onAdd}
          className="flex items-center gap-2 px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium rounded-xl transition-colors flex-shrink-0"
        >
          <Plus size={16} />
          {addLabel}
        </button>
      )}
    </div>
  )
}
