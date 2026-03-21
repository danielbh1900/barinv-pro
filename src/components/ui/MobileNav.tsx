// ============================================================
// MobileNav — bottom tab bar for mobile
// ============================================================

import { NavLink } from 'react-router-dom'
import { LayoutDashboard, ClipboardList, Package, Warehouse, Settings } from 'lucide-react'

export function MobileNav() {
  const tabs = [
    { label: 'Dashboard', path: '/dashboard',           icon: <LayoutDashboard size={20} /> },
    { label: 'Operations', path: '/operations/submit-event', icon: <ClipboardList size={20} /> },
    { label: 'Inventory',  path: '/inventory/clicker',  icon: <Package size={20} /> },
    { label: 'Warehouse',  path: '/warehouse/stock',    icon: <Warehouse size={20} /> },
    { label: 'Settings',   path: '/settings/profile',   icon: <Settings size={20} /> },
  ]

  return (
    <div className="flex items-center justify-around px-2 py-2 bg-surface-1">
      {tabs.map(tab => (
        <NavLink
          key={tab.path}
          to={tab.path}
          className={({ isActive }) =>
            `flex flex-col items-center gap-0.5 px-3 py-1 rounded-xl transition-colors min-w-[56px] ${
              isActive ? 'text-brand-400' : 'text-slate-500'
            }`
          }
        >
          {tab.icon}
          <span className="text-2xs font-medium">{tab.label}</span>
        </NavLink>
      ))}
    </div>
  )
}
