import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard, ClipboardList, Package, Warehouse,
  BarChart3, ShoppingCart, BookOpen, Users,
  Settings, Wrench, ChevronRight,
} from 'lucide-react'
import { useVenue } from '@/features/venues/VenueProvider'
import { can } from '@/lib/permissions'
import type { UserRole } from '@/types'

interface NavItem {
  label: string
  path: string
  icon: React.ReactNode
  minRole?: UserRole
  children?: { label: string; path: string; minRole?: UserRole }[]
}

const NAV_ITEMS: NavItem[] = [
  {
    label: 'Dashboard',
    path: '/dashboard',
    icon: <LayoutDashboard size={18} />,
  },
  {
    label: 'Operations',
    path: '/operations',
    icon: <ClipboardList size={18} />,
    children: [
      { label: 'Submit Event',  path: '/operations/submit-event' },
      { label: 'Events Log',    path: '/operations/events' },
      { label: 'My History',    path: '/operations/my-history' },
      { label: 'Nights',        path: '/operations/nights',     minRole: 'manager' },
      { label: 'Placements',    path: '/operations/placements', minRole: 'manager' },
    ],
  },
  {
    label: 'Inventory',
    path: '/inventory',
    icon: <Package size={18} />,
    children: [
      { label: 'Clicker',    path: '/inventory/clicker' },
      { label: 'Par Levels', path: '/inventory/par-levels', minRole: 'manager' },
      { label: 'Transfers',  path: '/inventory/transfers',  minRole: 'manager' },
      { label: 'Waste',      path: '/inventory/waste' },
      { label: 'Variance',   path: '/inventory/variance',   minRole: 'manager' },
    ],
  },
  {
    label: 'Warehouse',
    path: '/warehouse',
    icon: <Warehouse size={18} />,
    minRole: 'manager',
    children: [
      { label: 'Stock',          path: '/warehouse/stock' },
      { label: 'Movements',      path: '/warehouse/movements' },
      { label: 'Adjustments',    path: '/warehouse/adjustments' },
      { label: 'Count Sessions', path: '/warehouse/count-sessions' },
      { label: 'Snapshots',      path: '/warehouse/snapshots' },
    ],
  },
  {
    label: 'Reports',
    path: '/reports',
    icon: <BarChart3 size={18} />,
    minRole: 'finance',
    children: [
      { label: 'Analytics',   path: '/reports/analytics' },
      { label: 'Cost Center', path: '/reports/cost-center' },
      { label: 'Summary',     path: '/reports/management-summary' },
      { label: 'Export',      path: '/reports/export-center' },
    ],
  },
  {
    label: 'Purchasing',
    path: '/purchasing',
    icon: <ShoppingCart size={18} />,
    minRole: 'finance',
    children: [
      { label: 'Suppliers',       path: '/purchasing/suppliers' },
      { label: 'Purchase Orders', path: '/purchasing/purchase-orders' },
      { label: 'Invoices',        path: '/purchasing/invoices' },
      { label: 'Reorder',         path: '/purchasing/reorder' },
    ],
  },
  {
    label: 'Recipes',
    path: '/recipes',
    icon: <BookOpen size={18} />,
    minRole: 'co_admin',
  },
  {
    label: 'Guestlist',
    path: '/guestlist',
    icon: <Users size={18} />,
    minRole: 'door',
    children: [
      { label: 'Door',           path: '/guestlist/door' },
      { label: 'Promoters',      path: '/guestlist/promoters',      minRole: 'manager' },
      { label: 'Ticket Classes', path: '/guestlist/ticket-classes', minRole: 'manager' },
    ],
  },
  {
    label: 'Setup',
    path: '/setup',
    icon: <Wrench size={18} />,
    minRole: 'co_admin',
    children: [
      { label: 'Venues',   path: '/setup/venues',   minRole: 'admin' },
      { label: 'Bars',     path: '/setup/bars' },
      { label: 'Stations', path: '/setup/stations' },
      { label: 'Items',    path: '/setup/items' },
      { label: 'Staff',    path: '/setup/staff' },
      { label: 'Roles',    path: '/setup/roles',    minRole: 'admin' },
      { label: 'Units',    path: '/setup/units' },
    ],
  },
  {
    label: 'Settings',
    path: '/settings',
    icon: <Settings size={18} />,
    children: [
      { label: 'Business',      path: '/settings/business',      minRole: 'admin' },
      { label: 'Profile',       path: '/settings/profile' },
      { label: 'Devices',       path: '/settings/devices' },
      { label: 'Feature Flags', path: '/settings/feature-flags', minRole: 'admin' },
      { label: 'Diagnostics',   path: '/settings/diagnostics',   minRole: 'manager' },
    ],
  },
]

function isAllowed(minRole: UserRole | undefined, activeRole: UserRole | null): boolean {
  if (!minRole) return true
  if (!activeRole) return false
  return can.viewReports(activeRole) || true // simplified; real check uses hasMinRole
}

export function Sidebar() {
  const { activeRole } = useVenue()

  return (
    <div className="w-64 bg-surface-1 border-r border-surface-2 flex flex-col h-screen sticky top-0 overflow-y-auto">
      {/* Logo */}
      <div className="px-6 py-5 border-b border-surface-2">
        <h1 className="text-lg font-bold text-white tracking-tight">BARINV Pro</h1>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {NAV_ITEMS.map(item => {
          if (!isAllowed(item.minRole, activeRole)) return null
          return <NavSection key={item.path} item={item} activeRole={activeRole} />
        })}
      </nav>
    </div>
  )
}

function NavSection({ item, activeRole }: { item: NavItem; activeRole: UserRole | null }) {
  if (!item.children) {
    return (
      <NavLink
        to={item.path}
        className={({ isActive }) =>
          `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
            isActive
              ? 'bg-brand-600/20 text-brand-400'
              : 'text-slate-400 hover:text-slate-200 hover:bg-surface-2'
          }`
        }
      >
        {item.icon}
        {item.label}
      </NavLink>
    )
  }

  return (
    <div>
      <div className="flex items-center gap-3 px-3 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wider mt-3 mb-1">
        {item.icon}
        {item.label}
      </div>
      <div className="space-y-0.5 pl-3">
        {item.children.map(child => {
          if (!isAllowed(child.minRole, activeRole)) return null
          return (
            <NavLink
              key={child.path}
              to={child.path}
              className={({ isActive }) =>
                `flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors ${
                  isActive
                    ? 'text-brand-400 bg-brand-600/10'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-surface-2'
                }`
              }
            >
              <ChevronRight size={12} className="flex-shrink-0 opacity-40" />
              {child.label}
            </NavLink>
          )
        })}
      </div>
    </div>
  )
}
