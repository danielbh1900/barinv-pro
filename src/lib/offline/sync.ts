// ============================================================
// Sync Engine
// Processes the offline queue when online.
// Uses exponential backoff: 5s, 10s, 20s, 40s, 80s
// After RETRY_LIMIT failures → status=failed, surfaces in UI
// ============================================================

import { supabase } from '@/lib/supabase/client'
import { env } from '@/lib/utils/env'
import {
  getPendingItems,
  updateItemStatus,
  removeItem,
  type QueueItem,
} from './queue'

const RETRY_LIMIT = env.sync.retryLimit

// ─── Retry delay ─────────────────────────────────────────────

function retryDelay(attempt: number): number {
  return Math.min(5000 * Math.pow(2, attempt), 5 * 60 * 1000)
}

// ─── Process single item ─────────────────────────────────────

async function processItem(item: QueueItem): Promise<void> {
  if (item.retry_count >= RETRY_LIMIT) {
    await updateItemStatus(item.client_operation_id, 'failed', 'Max retries exceeded')
    return
  }

  // Enforce backoff — skip items not yet ready for retry
  if (item.last_attempt_at) {
    const elapsed = Date.now() - new Date(item.last_attempt_at).getTime()
    const delay = retryDelay(item.retry_count)
    if (elapsed < delay) return
  }

  try {
    await writeToServer(item)
    await removeItem(item.client_operation_id)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'

    // 409 = duplicate client_operation_id — already accepted, safe to remove
    if (message.includes('409') || message.includes('duplicate')) {
      await removeItem(item.client_operation_id)
      return
    }

    const nextCount = item.retry_count + 1
    if (nextCount >= RETRY_LIMIT) {
      await updateItemStatus(item.client_operation_id, 'failed', message)
    } else {
      await updateItemStatus(item.client_operation_id, 'pending', message)
    }
  }
}

// ─── Write to server ─────────────────────────────────────────

async function writeToServer(item: QueueItem): Promise<void> {
  switch (item.action_type) {
    case 'submit_event': {
      const { error } = await supabase
        .from('events')
        .insert(item.payload as never)
      if (error) throw new Error(error.message)
      break
    }

    case 'submit_waste': {
      const { error } = await supabase
        .from('waste_log')
        .insert(item.payload as never)
      if (error) throw new Error(error.message)
      break
    }

    case 'count_entry': {
      const { error } = await supabase
        .from('count_entries')
        .insert(item.payload as never)
      if (error) throw new Error(error.message)
      break
    }

    default:
      throw new Error(`Unknown action_type: ${item.action_type}`)
  }
}

// ─── Process full queue ──────────────────────────────────────

let isRunning = false

export async function processQueue(): Promise<void> {
  if (isRunning) return
  if (!navigator.onLine) return

  isRunning = true

  try {
    const pending = await getPendingItems()
    await Promise.allSettled(pending.map(processItem))
  } finally {
    isRunning = false
  }
}

// ─── Start background sync ───────────────────────────────────
// Calls processQueue whenever:
//   - device comes online
//   - visibility changes (tab refocused)
//   - every 30s while online

export function startBackgroundSync(): () => void {
  const onOnline = () => processQueue()
  const onVisible = () => { if (document.visibilityState === 'visible') processQueue() }

  window.addEventListener('online', onOnline)
  document.addEventListener('visibilitychange', onVisible)

  const interval = setInterval(() => {
    if (navigator.onLine) processQueue()
  }, 30_000)

  // Initial attempt
  processQueue()

  return () => {
    window.removeEventListener('online', onOnline)
    document.removeEventListener('visibilitychange', onVisible)
    clearInterval(interval)
  }
}
