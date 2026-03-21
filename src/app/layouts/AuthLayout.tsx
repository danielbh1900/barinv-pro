import { Outlet, Navigate } from 'react-router-dom'
import { useAuth } from '@/features/auth/AuthProvider'
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton'

export function AuthLayout() {
  const { session, isLoading, isInitialized } = useAuth()

  // Wait for auth state to initialize before deciding
  if (!isInitialized || isLoading) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <LoadingSkeleton variant="spinner" />
      </div>
    )
  }

  // Already authenticated — go to venue selection
  if (session) {
    return <Navigate to="/select-venue" replace />
  }

  return (
    <div className="min-h-screen bg-surface flex flex-col items-center justify-center px-4 py-12 pt-safe pb-safe">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-brand-600/20 mb-4">
            <span className="text-2xl">🍸</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white">BARINV Pro</h1>
          <p className="mt-1.5 text-sm text-slate-400">Hospitality Operations Platform</p>
        </div>

        <Outlet />
      </div>
    </div>
  )
}
