// ============================================================
// Core Domain Types
// ============================================================

export type UserRole =
  | 'owner'
  | 'admin'
  | 'co_admin'
  | 'manager'
  | 'finance'
  | 'bartender'
  | 'barback'
  | 'door'
  | 'promoter'

export type QueueStatus = 'pending' | 'synced' | 'failed' | 'conflict' | 'blocked'

export type AuditSource = 'ui' | 'sync' | 'system' | 'admin_override' | 'migration' | 'edge_function'

export type ConflictStatus = 'open' | 'resolved_local' | 'resolved_server' | 'deferred'

// ─── Organization ────────────────────────────────────────────

export interface Organization {
  id: string
  name: string
  slug: string
  logo_url: string | null
  active: boolean
  created_at: string
  updated_at: string
}

// ─── Venue ───────────────────────────────────────────────────

export interface Venue {
  id: string
  organization_id: string
  name: string
  slug: string
  timezone: string
  address: string | null
  active: boolean
  settings: VenueSettings
  created_at: string
  updated_at: string
}

export interface VenueSettings {
  night_boundary_hour?: number  // default: 4
  [key: string]: unknown
}

// ─── Profile ─────────────────────────────────────────────────

export interface Profile {
  id: string
  organization_id: string
  full_name: string
  display_name: string | null
  phone: string | null
  avatar_url: string | null
  active: boolean
  created_at: string
  updated_at: string
}

// ─── Venue User ──────────────────────────────────────────────

export interface VenueUser {
  id: string
  organization_id: string
  venue_id: string
  user_id: string
  role: UserRole
  station_id: string | null
  active: boolean
  created_at: string
  updated_at: string
}

// ─── Auth Session ────────────────────────────────────────────

export interface AppSession {
  user: Profile
  role: UserRole
  venue: Venue
  organization: Organization
}

// ─── Feature Flags ───────────────────────────────────────────

export type FeatureFlagKey =
  | 'guestlist'
  | 'purchasing'
  | 'recipes'
  | 'advanced_analytics'
  | 'offline_sync'
  | 'multi_venue'

export interface FeatureFlag {
  id: string
  organization_id: string
  feature_key: FeatureFlagKey
  enabled: boolean
  updated_at: string
}

// ─── Offline Queue ───────────────────────────────────────────

export interface OfflineQueueItem {
  client_operation_id: string
  action_type: string
  target_table: string
  payload: Record<string, unknown>
  status: QueueStatus
  retry_count: number
  last_attempt_at: string | null
  created_at: string
  submitted_at_local: string
}

// ─── Sync Conflict ───────────────────────────────────────────

export interface SyncConflict {
  id: string
  organization_id: string
  venue_id: string
  client_operation_id: string
  action_type: string
  target_table: string
  target_id: string | null
  local_value: Record<string, unknown>
  local_submitted_at: string | null
  server_value: Record<string, unknown>
  server_updated_at: string | null
  server_updated_by: string | null
  status: ConflictStatus
  resolved_by: string | null
  resolved_at: string | null
  resolution_note: string | null
  created_at: string
  updated_at: string
}

// ─── Utility Types ───────────────────────────────────────────

export type Nullable<T> = T | null
export type Optional<T> = T | undefined

// API response wrapper
export interface ApiResult<T> {
  data: T | null
  error: string | null
}

// Pagination
export interface PaginatedResult<T> {
  data: T[]
  count: number
  page: number
  page_size: number
}
