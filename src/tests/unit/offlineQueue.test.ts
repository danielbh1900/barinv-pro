import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock idb since it uses IndexedDB which isn't in jsdom
vi.mock('idb', () => ({
  openDB: vi.fn().mockResolvedValue({
    put: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue(null),
    getAll: vi.fn().mockResolvedValue([]),
    getAllFromIndex: vi.fn().mockResolvedValue([]),
    delete: vi.fn().mockResolvedValue(undefined),
    transaction: vi.fn().mockReturnValue({
      store: { delete: vi.fn() },
      done: Promise.resolve(),
    }),
    createObjectStore: vi.fn(),
  }),
}))

vi.mock('@/lib/utils/env', () => ({
  env: {
    supabase: { url: 'http://localhost', anonKey: 'test' },
    app: { name: 'Test', env: 'test', version: '0.0.0' },
    sentry: { enabled: false, dsn: '' },
    sync: { retryLimit: 5, staleMinutes: 15 },
    features: { offline: true, guestlist: false, purchasing: false, recipes: false },
    isDev: true,
    isProd: false,
  },
}))

describe('offline queue', () => {
  it('generates a UUID v4 client_operation_id on enqueue', async () => {
    const { enqueue } = await import('@/lib/offline/queue')
    const id = await enqueue('submit_event', 'events', { foo: 'bar' })
    // UUID v4 pattern
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
  })

  it('injects client_operation_id into payload', async () => {
    const { enqueue } = await import('@/lib/offline/queue')
    const { openDB } = await import('idb')
    const mockDB = await (openDB as ReturnType<typeof vi.fn>)()

    await enqueue('submit_event', 'events', { venue_id: 'abc' })

    expect(mockDB.put).toHaveBeenCalledWith(
      'queue',
      expect.objectContaining({
        action_type: 'submit_event',
        target_table: 'events',
        status: 'pending',
        retry_count: 0,
        payload: expect.objectContaining({
          venue_id: 'abc',
          client_operation_id: expect.any(String),
        }),
      })
    )
  })
})
