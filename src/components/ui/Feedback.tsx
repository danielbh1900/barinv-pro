// ============================================================
// LoadingSkeleton
// ============================================================

interface LoadingSkeletonProps {
  variant?: 'spinner' | 'block' | 'row'
  rows?: number
  className?: string
}

export function LoadingSkeleton({ variant = 'block', rows = 3, className = '' }: LoadingSkeletonProps) {
  if (variant === 'spinner') {
    return (
      <div className={`flex items-center justify-center ${className}`}>
        <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (variant === 'row') {
    return (
      <div className={`space-y-3 ${className}`}>
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="h-12 bg-surface-2 rounded-lg animate-pulse" />
        ))}
      </div>
    )
  }

  return (
    <div className={`space-y-4 ${className}`}>
      <div className="h-6 bg-surface-2 rounded w-1/3 animate-pulse" />
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-4 bg-surface-2 rounded animate-pulse" style={{ width: `${70 + (i % 3) * 10}%` }} />
      ))}
    </div>
  )
}

// ============================================================
// EmptyState
// ============================================================

interface EmptyStateProps {
  icon?: string
  title: string
  description?: string
  action?: {
    label: string
    onClick: () => void
  }
}

export function EmptyState({ icon = '📭', title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      <div className="text-5xl mb-4">{icon}</div>
      <h3 className="text-lg font-semibold text-slate-200 mb-2">{title}</h3>
      {description && <p className="text-sm text-slate-400 max-w-sm mb-6">{description}</p>}
      {action && (
        <button
          onClick={action.onClick}
          className="px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium rounded-lg transition-colors"
        >
          {action.label}
        </button>
      )}
    </div>
  )
}

// ============================================================
// ErrorState
// ============================================================

interface ErrorStateProps {
  title?: string
  message?: string
  onRetry?: () => void
}

export function ErrorState({
  title = 'Something went wrong',
  message = 'An unexpected error occurred. Please try again.',
  onRetry,
}: ErrorStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      <div className="text-5xl mb-4">⚠️</div>
      <h3 className="text-lg font-semibold text-slate-200 mb-2">{title}</h3>
      <p className="text-sm text-slate-400 max-w-sm mb-6">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="px-4 py-2 bg-surface-2 hover:bg-surface-3 text-slate-200 text-sm font-medium rounded-lg transition-colors"
        >
          Try again
        </button>
      )}
    </div>
  )
}

// ============================================================
// StatusChip
// ============================================================

type StatusChipVariant = 'success' | 'warning' | 'danger' | 'info' | 'neutral'

interface StatusChipProps {
  label: string
  variant?: StatusChipVariant
  size?: 'sm' | 'md'
}

const CHIP_STYLES: Record<StatusChipVariant, string> = {
  success: 'bg-success/10 text-success border-success/20',
  warning: 'bg-warning/10 text-warning border-warning/20',
  danger:  'bg-danger/10 text-danger border-danger/20',
  info:    'bg-info/10 text-info border-info/20',
  neutral: 'bg-surface-2 text-slate-400 border-surface-3',
}

export function StatusChip({ label, variant = 'neutral', size = 'md' }: StatusChipProps) {
  const sizeClass = size === 'sm' ? 'px-2 py-0.5 text-2xs' : 'px-2.5 py-1 text-xs'
  return (
    <span className={`inline-flex items-center border rounded-full font-medium ${sizeClass} ${CHIP_STYLES[variant]}`}>
      {label}
    </span>
  )
}

// ============================================================
// ConfirmDialog
// ============================================================

interface ConfirmDialogProps {
  open: boolean
  title: string
  description: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'danger' | 'warning' | 'default'
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'default',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  if (!open) return null

  const confirmStyle =
    variant === 'danger'
      ? 'bg-danger hover:bg-danger/90 text-white'
      : variant === 'warning'
      ? 'bg-warning hover:bg-warning/90 text-black'
      : 'bg-brand-600 hover:bg-brand-700 text-white'

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onCancel} />

      {/* Dialog */}
      <div className="relative bg-surface-1 border border-surface-2 rounded-2xl p-6 w-full max-w-sm shadow-xl animate-fade-in">
        <h3 className="text-base font-semibold text-slate-100 mb-2">{title}</h3>
        <p className="text-sm text-slate-400 mb-6">{description}</p>
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 py-2.5 px-4 bg-surface-2 hover:bg-surface-3 text-slate-200 text-sm font-medium rounded-xl transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className={`flex-1 py-2.5 px-4 text-sm font-medium rounded-xl transition-colors ${confirmStyle}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
