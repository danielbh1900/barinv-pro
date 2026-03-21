// ============================================================
// Role Permission Helpers (Client-side)
// Mirror of the database role hierarchy.
// These are for UI gating only — RLS is the real enforcement.
// ============================================================

import type { UserRole } from '@/types'

// Role hierarchy: higher index = more authority
const ROLE_HIERARCHY: UserRole[] = [
  'promoter',
  'door',
  'barback',
  'bartender',
  'finance',
  'manager',
  'co_admin',
  'admin',
  'owner',
]

function getRoleLevel(role: UserRole): number {
  return ROLE_HIERARCHY.indexOf(role)
}

export function hasMinRole(userRole: UserRole, minRole: UserRole): boolean {
  return getRoleLevel(userRole) >= getRoleLevel(minRole)
}

export function isOrgAdmin(role: UserRole): boolean {
  return role === 'owner' || role === 'admin'
}

// ─── Permission checks ───────────────────────────────────────

export const can = {
  submitEvent:        (role: UserRole) => hasMinRole(role, 'barback'),
  approveEvent:       (role: UserRole) => hasMinRole(role, 'manager'),
  viewEventsLog:      (role: UserRole) => hasMinRole(role, 'bartender'),
  useInventoryClicker:(role: UserRole) => hasMinRole(role, 'barback'),
  viewWarehouse:      (role: UserRole) => hasMinRole(role, 'manager'),
  writeWarehouse:     (role: UserRole) => hasMinRole(role, 'manager'),
  adjustStock:        (role: UserRole) => hasMinRole(role, 'manager'),
  viewCostData:       (role: UserRole) => hasMinRole(role, 'finance'),
  approveInvoice:     (role: UserRole) => role === 'finance' || hasMinRole(role, 'co_admin'),
  manageSuppliers:    (role: UserRole) => role === 'finance' || hasMinRole(role, 'co_admin'),
  viewReports:        (role: UserRole) => hasMinRole(role, 'finance'),
  exportData:         (role: UserRole) => hasMinRole(role, 'finance'),
  manageStaff:        (role: UserRole) => hasMinRole(role, 'co_admin'),
  manageSetup:        (role: UserRole) => hasMinRole(role, 'co_admin'),
  changeParLevels:    (role: UserRole) => hasMinRole(role, 'manager'),
  viewGuestlist:      (role: UserRole) => hasMinRole(role, 'door'),
  writeGuestlist:     (role: UserRole) => hasMinRole(role, 'door'),
  resolveConflicts:   (role: UserRole) => hasMinRole(role, 'manager'),
  viewAuditLog:       (role: UserRole) => isOrgAdmin(role),
  manageFeatureFlags: (role: UserRole) => isOrgAdmin(role),
  deleteOrg:          (role: UserRole) => role === 'owner',
} as const

export type PermissionKey = keyof typeof can
