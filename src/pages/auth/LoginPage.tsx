import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Eye, EyeOff, LogIn, AlertCircle } from 'lucide-react'
import { useAuth } from '@/features/auth/AuthProvider'

// ─── Schema ──────────────────────────────────────────────────

const loginSchema = z.object({
  email: z
    .string()
    .min(1, 'Email is required')
    .email('Enter a valid email address'),
  password: z
    .string()
    .min(1, 'Password is required')
    .min(6, 'Password must be at least 6 characters'),
})

type LoginFormValues = z.infer<typeof loginSchema>

// ─── Component ───────────────────────────────────────────────

export function LoginPage() {
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const [showPassword, setShowPassword] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)

  const from = (location.state as { from?: { pathname: string } })?.from?.pathname ?? '/select-venue'

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  })

  const onSubmit = async (values: LoginFormValues) => {
    setServerError(null)
    const { error } = await signIn(values.email, values.password)
    if (error) {
      setServerError(
        error.toLowerCase().includes('invalid')
          ? 'Incorrect email or password.'
          : error
      )
      return
    }
    navigate(from, { replace: true })
  }

  return (
    <div className="w-full">
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-5">

        {/* Server error */}
        {serverError && (
          <div className="flex items-start gap-3 px-4 py-3 bg-danger/10 border border-danger/20 rounded-xl text-danger text-sm">
            <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
            <span>{serverError}</span>
          </div>
        )}

        {/* Email */}
        <div className="space-y-1.5">
          <label htmlFor="email" className="block text-sm font-medium text-slate-300">
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            autoCapitalize="none"
            autoCorrect="off"
            inputMode="email"
            placeholder="you@venue.com"
            {...register('email')}
            className={`
              w-full px-4 py-3 rounded-xl bg-surface-1 border text-slate-100
              placeholder:text-slate-500 text-sm transition-colors
              focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent
              ${errors.email ? 'border-danger' : 'border-surface-3'}
            `}
          />
          {errors.email && (
            <p className="text-xs text-danger flex items-center gap-1">
              <AlertCircle size={12} />
              {errors.email.message}
            </p>
          )}
        </div>

        {/* Password */}
        <div className="space-y-1.5">
          <label htmlFor="password" className="block text-sm font-medium text-slate-300">
            Password
          </label>
          <div className="relative">
            <input
              id="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              placeholder="••••••••"
              {...register('password')}
              className={`
                w-full px-4 py-3 pr-11 rounded-xl bg-surface-1 border text-slate-100
                placeholder:text-slate-500 text-sm transition-colors
                focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent
                ${errors.password ? 'border-danger' : 'border-surface-3'}
              `}
            />
            <button
              type="button"
              onClick={() => setShowPassword(prev => !prev)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 transition-colors p-1"
              tabIndex={-1}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          {errors.password && (
            <p className="text-xs text-danger flex items-center gap-1">
              <AlertCircle size={12} />
              {errors.password.message}
            </p>
          )}
        </div>

        {/* Submit */}
        <button
          type="submit"
          disabled={isSubmitting}
          className="
            w-full flex items-center justify-center gap-2
            py-3 px-4 rounded-xl font-medium text-sm text-white
            bg-brand-600 hover:bg-brand-700 active:bg-brand-800
            disabled:opacity-50 disabled:cursor-not-allowed
            transition-colors mt-2
          "
        >
          {isSubmitting ? (
            <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            <LogIn size={16} />
          )}
          {isSubmitting ? 'Signing in...' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}
