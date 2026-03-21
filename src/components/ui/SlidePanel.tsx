import { useEffect, type ReactNode } from 'react'
import { X } from 'lucide-react'

interface SlidePanelProps {
  open: boolean
  title: string
  description?: string
  onClose: () => void
  children: ReactNode
  width?: 'sm' | 'md' | 'lg'
}

const WIDTH = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
}

export function SlidePanel({
  open,
  title,
  description,
  onClose,
  children,
  width = 'md',
}: SlidePanelProps) {
  // Lock body scroll when open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [open])

  // Close on Escape
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
      />

      {/* Panel */}
      <div
        className={`
          relative ml-auto h-full w-full ${WIDTH[width]}
          bg-surface-1 border-l border-surface-2
          flex flex-col shadow-2xl
          animate-slide-in-right
        `}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-5 border-b border-surface-2 flex-shrink-0">
          <div>
            <h2 className="text-base font-semibold text-slate-100">{title}</h2>
            {description && (
              <p className="text-sm text-slate-400 mt-0.5">{description}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1.5 -mr-1.5 text-slate-400 hover:text-slate-200 hover:bg-surface-2 rounded-lg transition-colors"
            aria-label="Close panel"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-5 pb-safe">
          {children}
        </div>
      </div>
    </div>
  )
}
