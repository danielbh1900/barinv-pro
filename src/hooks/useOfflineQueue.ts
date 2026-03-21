import { useState, useEffect, useCallback } from 'react'
import { getQueueCounts, getFailedItems, type QueueItem } from '@/lib/offline/queue'
import { processQueue } from '@/lib/offline/sync'

interface QueueState {
  pending: number
  failed: number
  conflict: number
  failedItems: QueueItem[]
  isLoading: boolean
}

export function useOfflineQueue(): QueueState & { retry: () => void } {
  const [state, setState] = useState<QueueState>({
    pending: 0,
    failed: 0,
    conflict: 0,
    failedItems: [],
    isLoading: true,
  })

  const refresh = useCallback(async () => {
    const [counts, failedItems] = await Promise.all([
      getQueueCounts(),
      getFailedItems(),
    ])
    setState({ ...counts, failedItems, isLoading: false })
  }, [])

  useEffect(() => {
    refresh()
    // Refresh counts every 10s while mounted
    const interval = setInterval(refresh, 10_000)
    return () => clearInterval(interval)
  }, [refresh])

  const retry = useCallback(async () => {
    await processQueue()
    await refresh()
  }, [refresh])

  return { ...state, retry }
}
