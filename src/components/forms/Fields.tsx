import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'
import { AlertCircle } from 'lucide-react'

// ─── Field wrapper ────────────────────────────────────────────

interface FieldProps {
  label: string
  error?: string
  hint?: string
  required?: boolean
  children: React.ReactNode
}

export function Field({ label, error, hint, required, children }: FieldProps) {
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-medium text-slate-300">
        {label}
        {required && <span className="text-danger ml-1">*</span>}
      </label>
      {children}
      {hint && !error && (
        <p className="text-xs text-slate-500">{hint}</p>
      )}
      {error && (
        <p className="text-xs text-danger flex items-center gap-1">
          <AlertCircle size={12} className="flex-shrink-0" />
          {error}
        </p>
      )}
    </div>
  )
}

// ─── Input ────────────────────────────────────────────────────

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: boolean
}

export function Input({ error, className = '', ...props }: InputProps) {
  return (
    <input
      {...props}
      className={`
        w-full px-4 py-2.5 rounded-xl bg-surface text-slate-100 text-sm
        border transition-colors placeholder:text-slate-500
        focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent
        disabled:opacity-50 disabled:cursor-not-allowed
        ${error ? 'border-danger' : 'border-surface-3'}
        ${className}
      `}
    />
  )
}

// ─── Select ───────────────────────────────────────────────────

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  error?: boolean
  placeholder?: string
}

export function Select({ error, placeholder, children, className = '', ...props }: SelectProps) {
  return (
    <select
      {...props}
      className={`
        w-full px-4 py-2.5 rounded-xl bg-surface text-slate-100 text-sm
        border transition-colors
        focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent
        disabled:opacity-50 disabled:cursor-not-allowed
        ${error ? 'border-danger' : 'border-surface-3'}
        ${className}
      `}
    >
      {placeholder && (
        <option value="" disabled>
          {placeholder}
        </option>
      )}
      {children}
    </select>
  )
}

// ─── Textarea ─────────────────────────────────────────────────

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: boolean
}

export function Textarea({ error, className = '', ...props }: TextareaProps) {
  return (
    <textarea
      {...props}
      className={`
        w-full px-4 py-2.5 rounded-xl bg-surface text-slate-100 text-sm
        border transition-colors placeholder:text-slate-500 resize-none
        focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent
        disabled:opacity-50 disabled:cursor-not-allowed
        ${error ? 'border-danger' : 'border-surface-3'}
        ${className}
      `}
    />
  )
}

// ─── Toggle ───────────────────────────────────────────────────

interface ToggleProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label?: string
  disabled?: boolean
}

export function Toggle({ checked, onChange, label, disabled }: ToggleProps) {
  return (
    <label className={`flex items-center gap-3 ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => !disabled && onChange(!checked)}
        className={`
          relative w-10 h-6 rounded-full transition-colors flex-shrink-0
          focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 focus:ring-offset-surface
          ${checked ? 'bg-brand-600' : 'bg-surface-3'}
        `}
      >
        <span
          className={`
            absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow transition-transform
            ${checked ? 'translate-x-4' : 'translate-x-0'}
          `}
        />
      </button>
      {label && <span className="text-sm text-slate-300">{label}</span>}
    </label>
  )
}

// ─── Form action bar ──────────────────────────────────────────

interface FormActionsProps {
  onCancel: () => void
  submitLabel?: string
  isSubmitting?: boolean
  isDanger?: boolean
}

export function FormActions({
  onCancel,
  submitLabel = 'Save',
  isSubmitting = false,
  isDanger = false,
}: FormActionsProps) {
  return (
    <div className="flex gap-3 pt-4 border-t border-surface-2 mt-6">
      <button
        type="button"
        onClick={onCancel}
        className="flex-1 py-2.5 px-4 rounded-xl text-sm font-medium text-slate-300 bg-surface-2 hover:bg-surface-3 transition-colors"
      >
        Cancel
      </button>
      <button
        type="submit"
        disabled={isSubmitting}
        className={`
          flex-1 py-2.5 px-4 rounded-xl text-sm font-medium text-white transition-colors
          disabled:opacity-50 disabled:cursor-not-allowed
          flex items-center justify-center gap-2
          ${isDanger
            ? 'bg-danger hover:bg-danger/90'
            : 'bg-brand-600 hover:bg-brand-700'
          }
        `}
      >
        {isSubmitting && (
          <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
        )}
        {isSubmitting ? 'Saving...' : submitLabel}
      </button>
    </div>
  )
}
