import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from 'react'
import { CheckCircle, AlertCircle, Info, X, AlertTriangle } from 'lucide-react'

// ─── Types ───────────────────────────────────────────────────

type ToastVariant = 'success' | 'error' | 'warning' | 'info'

interface Toast {
  id: string
  message: string
  variant: ToastVariant
  duration?: number
}

interface ToastContextValue {
  toast: (message: string, variant?: ToastVariant, duration?: number) => void
  success: (message: string) => void
  error: (message: string) => void
  warning: (message: string) => void
  info: (message: string) => void
}

// ─── Context ─────────────────────────────────────────────────

const ToastContext = createContext<ToastContextValue | null>(null)

// ─── Icons ───────────────────────────────────────────────────

const ICONS: Record<ToastVariant, ReactNode> = {
  success: <CheckCircle size={16} />,
  error:   <AlertCircle size={16} />,
  warning: <AlertTriangle size={16} />,
  info:    <Info size={16} />,
}

const STYLES: Record<ToastVariant, string> = {
  success: 'bg-surface-1 border-success/30 text-success',
  error:   'bg-surface-1 border-danger/30 text-danger',
  warning: 'bg-surface-1 border-warning/30 text-warning',
  info:    'bg-surface-1 border-info/30 text-info',
}

const TEXT_STYLES: Record<ToastVariant, string> = {
  success: 'text-slate-200',
  error:   'text-slate-200',
  warning: 'text-slate-200',
  info:    'text-slate-200',
}

// ─── Single Toast Item ────────────────────────────────────────

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: string) => void }) {
  useEffect(() => {
    const duration = toast.duration ?? 4000
    const timer = setTimeout(() => onDismiss(toast.id), duration)
    return () => clearTimeout(timer)
  }, [toast.id, toast.duration, onDismiss])

  return (
    <div
      className={`
        flex items-start gap-3 px-4 py-3 rounded-2xl border shadow-lg
        min-w-[280px] max-w-[360px] animate-slide-in-right
        ${STYLES[toast.variant]}
      `}
      role="alert"
    >
      <span className="flex-shrink-0 mt-0.5">{ICONS[toast.variant]}</span>
      <p className={`flex-1 text-sm font-medium leading-snug ${TEXT_STYLES[toast.variant]}`}>
        {toast.message}
      </p>
      <button
        onClick={() => onDismiss(toast.id)}
        className="flex-shrink-0 text-slate-500 hover:text-slate-300 transition-colors mt-0.5"
        aria-label="Dismiss"
      >
        <X size={14} />
      </button>
    </div>
  )
}

// ─── Provider ────────────────────────────────────────────────

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const dismiss = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  const toast = useCallback((
    message: string,
    variant: ToastVariant = 'info',
    duration?: number
  ) => {
    const id = crypto.randomUUID()
    setToasts(prev => [...prev, { id, message, variant, duration }])
  }, [])

  const success = useCallback((msg: string) => toast(msg, 'success'), [toast])
  const error   = useCallback((msg: string) => toast(msg, 'error', 6000), [toast])
  const warning = useCallback((msg: string) => toast(msg, 'warning'), [toast])
  const info    = useCallback((msg: string) => toast(msg, 'info'), [toast])

  return (
    <ToastContext.Provider value={{ toast, success, error, warning, info }}>
      {children}

      {/* Toast container */}
      {toasts.length > 0 && (
        <div
          aria-live="polite"
          aria-atomic="false"
          className="fixed bottom-0 right-0 z-50 flex flex-col gap-2 p-4 pb-safe pointer-events-none"
        >
          {toasts.map(t => (
            <div key={t.id} className="pointer-events-auto">
              <ToastItem toast={t} onDismiss={dismiss} />
            </div>
          ))}
        </div>
      )}
    </ToastContext.Provider>
  )
}

// ─── Hook ────────────────────────────────────────────────────

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}
