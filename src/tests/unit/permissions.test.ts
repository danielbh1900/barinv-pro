import { describe, it, expect } from 'vitest'
import { hasMinRole, isOrgAdmin, can } from '@/lib/permissions'

describe('hasMinRole', () => {
  it('owner passes all role checks', () => {
    expect(hasMinRole('owner', 'promoter')).toBe(true)
    expect(hasMinRole('owner', 'manager')).toBe(true)
    expect(hasMinRole('owner', 'owner')).toBe(true)
  })

  it('bartender cannot pass manager check', () => {
    expect(hasMinRole('bartender', 'manager')).toBe(false)
  })

  it('manager passes bartender check', () => {
    expect(hasMinRole('manager', 'bartender')).toBe(true)
  })

  it('promoter fails all checks above promoter', () => {
    expect(hasMinRole('promoter', 'door')).toBe(false)
    expect(hasMinRole('promoter', 'bartender')).toBe(false)
    expect(hasMinRole('promoter', 'manager')).toBe(false)
  })

  it('same role passes its own check', () => {
    expect(hasMinRole('manager', 'manager')).toBe(true)
    expect(hasMinRole('finance', 'finance')).toBe(true)
  })
})

describe('isOrgAdmin', () => {
  it('owner and admin return true', () => {
    expect(isOrgAdmin('owner')).toBe(true)
    expect(isOrgAdmin('admin')).toBe(true)
  })

  it('co_admin and below return false', () => {
    expect(isOrgAdmin('co_admin')).toBe(false)
    expect(isOrgAdmin('manager')).toBe(false)
    expect(isOrgAdmin('bartender')).toBe(false)
  })
})

describe('can permissions', () => {
  it('bartender can submit events', () => {
    expect(can.submitEvent('bartender')).toBe(true)
  })

  it('bartender cannot approve events', () => {
    expect(can.approveEvent('bartender')).toBe(false)
  })

  it('manager can approve events', () => {
    expect(can.approveEvent('manager')).toBe(true)
  })

  it('bartender cannot view cost data', () => {
    expect(can.viewCostData('bartender')).toBe(false)
  })

  it('finance can view cost data', () => {
    expect(can.viewCostData('finance')).toBe(true)
  })

  it('door role can view guestlist', () => {
    expect(can.viewGuestlist('door')).toBe(true)
  })

  it('bartender cannot view guestlist', () => {
    expect(can.viewGuestlist('bartender')).toBe(false)
  })

  it('only owner can delete org', () => {
    expect(can.deleteOrg('owner')).toBe(true)
    expect(can.deleteOrg('admin')).toBe(false)
  })
})
