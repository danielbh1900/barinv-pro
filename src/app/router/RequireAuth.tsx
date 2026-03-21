import { Navigate, Outlet, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import type { UserRole } from '@/types'
import { hasMinRole } from '@/lib/permissions'
import { useAuth } from '@/features/auth/AuthProvider'
import { useVenue } from '@/features/venues/VenueProvider'
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton'

// ─── RequireAuth ─────────────────────────────────────────────

export function RequireAuth() {
  const { session, isLoading, isInitialized } = useAuth()
  const location = useLocation()

  if (!isInitialized || isLoading) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <LoadingSkeleton variant="spinner" />
      </div>
    )
  }

  if (!session) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  return <Outlet />
}

// ─── RequireVenue ────────────────────────────────────────────

export function RequireVenue() {
  const { activeVenue, isLoading } = useVenue()
  const location = useLocation()

  if (isLoading) return null

  if (!activeVenue) {
    return <Navigate to="/select-venue" state={{ from: location }} replace />
  }

  return <Outlet />
}

// ─── RequireRole ─────────────────────────────────────────────

interface RequireRoleProps {
  minRole: UserRole
  children: ReactNode
}

export function RequireRole({ minRole, children }: RequireRoleProps) {
  const { activeRole } = useVenue()

  if (!activeRole || !hasMinRole(activeRole, minRole)) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-center px-6">
        <div className="text-5xl">🔒</div>
        <h2 className="text-xl font-semibold text-slate-100">Access Restricted</h2>
        <p className="text-slate-400 max-w-sm text-sm">
          You do not have permission to view this page. Contact your manager if you need access.
        </p>
      </div>
    )
  }

  return <>{children}</>
}
