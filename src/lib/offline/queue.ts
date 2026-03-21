// ============================================================
// Offline Queue
// IndexedDB-backed write queue with idempotency via
// client_operation_id (UUID v4).
//
// Flow:
//   1. enqueue(action)      — write to IndexedDB, status=pending
//   2. processQueue()       — attempt server writes
//   3. On success           — status=synced
//   4. On failure           — retry with backoff (max 5 attempts)
//   5. After 5 failures     — status=failed, surface in diagnostics
// ============================================================

import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { QueueStatus } from '@/types'

// ─── DB Schema ───────────────────────────────────────────────

interface QueueDB extends DBSchema {
  queue: {
    key: string   // client_operation_id
    value: QueueItem
    indexes: {
      by_status: QueueStatus
      by_created: string
    }
  }
}

export interface QueueItem {
  client_operation_id: string
  action_type: string
  target_table: string
  payload: Record<string, unknown>
  status: QueueStatus
  retry_count: number
  last_attempt_at: string | null
  error_message: string | null
  created_at: string
  submitted_at_local: string
}

// ─── DB singleton ────────────────────────────────────────────

let db: IDBPDatabase<QueueDB> | null = null

async function getDB(): Promise<IDBPDatabase<QueueDB>> {
  if (db) return db

  db = await openDB<QueueDB>('barinv-offline-queue', 1, {
    upgrade(database) {
      const store = database.createObjectStore('queue', {
        keyPath: 'client_operation_id',
      })
      store.createIndex('by_status', 'status')
      store.createIndex('by_created', 'created_at')
    },
  })

  return db
}

// ─── Public API ──────────────────────────────────────────────

export async function enqueue(
  actionType: string,
  targetTable: string,
  payload: Record<string, unknown>
): Promise<string> {
  const database = await getDB()
  const id = crypto.randomUUID()
  const now = new Date().toISOString()

  const item: QueueItem = {
    client_operation_id: id,
    action_type: actionType,
    target_table: targetTable,
    payload: { ...payload, client_operation_id: id },
    status: 'pending',
    retry_count: 0,
    last_attempt_at: null,
    error_message: null,
    created_at: now,
    submitted_at_local: now,
  }

  await database.put('queue', item)
  return id
}

export async function getAllQueued(): Promise<QueueItem[]> {
  const database = await getDB()
  return database.getAll('queue')
}

export async function getPendingItems(): Promise<QueueItem[]> {
  const database = await getDB()
  return database.getAllFromIndex('queue', 'by_status', 'pending')
}

export async function getFailedItems(): Promise<QueueItem[]> {
  const database = await getDB()
  return database.getAllFromIndex('queue', 'by_status', 'failed')
}

export async function updateItemStatus(
  id: string,
  status: QueueStatus,
  errorMessage?: string
): Promise<void> {
  const database = await getDB()
  const item = await database.get('queue', id)
  if (!item) return

  await database.put('queue', {
    ...item,
    status,
    last_attempt_at: new Date().toISOString(),
    retry_count: status === 'failed' ? item.retry_count + 1 : item.retry_count,
    error_message: errorMessage ?? null,
  })
}

export async function removeItem(id: string): Promise<void> {
  const database = await getDB()
  await database.delete('queue', id)
}

export async function clearSynced(): Promise<void> {
  const database = await getDB()
  const synced = await database.getAllFromIndex('queue', 'by_status', 'synced')
  const tx = database.transaction('queue', 'readwrite')
  await Promise.all(synced.map(item => tx.store.delete(item.client_operation_id)))
  await tx.done
}

export async function getQueueCounts(): Promise<{
  pending: number
  failed: number
  conflict: number
  synced: number
}> {
  const database = await getDB()
  const all = await database.getAll('queue')
  return {
    pending:  all.filter(i => i.status === 'pending').length,
    failed:   all.filter(i => i.status === 'failed').length,
    conflict: all.filter(i => i.status === 'conflict').length,
    synced:   all.filter(i => i.status === 'synced').length,
  }
}
