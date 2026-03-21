import { useEffect, type ReactNode } from 'react'
import { startBackgroundSync } from '@/lib/offline/sync'
import { useAuth } from '@/features/auth/AuthProvider'

export function SyncProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth()

  useEffect(() => {
    if (!session) return
    const stop = startBackgroundSync()
    return stop
  }, [session])

  return <>{children}</>
}
