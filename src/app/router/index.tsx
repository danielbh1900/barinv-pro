import { createBrowserRouter, Navigate } from 'react-router-dom'

// Layouts
import { RootLayout } from '@/app/layouts/RootLayout'
import { AuthLayout } from '@/app/layouts/AuthLayout'
import { AppLayout } from '@/app/layouts/AppLayout'

// Route guards
import { RequireAuth } from '@/app/router/RequireAuth'
import { RequireVenue } from '@/app/router/RequireVenue'
import { RequireRole } from '@/app/router/RequireRole'

// Pages — Auth
import { LoginPage } from '@/pages/auth/LoginPage'
import { SelectVenuePage } from '@/pages/auth/SelectVenuePage'

// Pages — Dashboard
import { DashboardPage } from '@/pages/DashboardPage'

// Pages — Operations
import { SubmitEventPage } from '@/pages/operations/SubmitEventPage'
import { EventsLogPage } from '@/pages/operations/EventsLogPage'
import { MyHistoryPage } from '@/pages/operations/MyHistoryPage'
import { NightsPage } from '@/pages/operations/NightsPage'
import { PlacementsPage } from '@/pages/operations/PlacementsPage'

// Pages — Inventory
import { InventoryClickerPage } from '@/pages/inventory/InventoryClickerPage'
import { ParLevelsPage } from '@/pages/inventory/ParLevelsPage'
import { TransfersPage } from '@/pages/inventory/TransfersPage'
import { WastePage } from '@/pages/inventory/WastePage'
import { VariancePage } from '@/pages/inventory/VariancePage'

// Pages — Warehouse
import { WarehousePage } from '@/pages/warehouse/WarehousePage'
import { WarehouseStockPage } from '@/pages/warehouse/WarehouseStockPage'
import { WarehouseMovementsPage } from '@/pages/warehouse/WarehouseMovementsPage'
import { WarehouseAdjustmentsPage } from '@/pages/warehouse/WarehouseAdjustmentsPage'
import { WarehouseSnapshotsPage } from '@/pages/warehouse/WarehouseSnapshotsPage'
import { CountSessionsPage } from '@/pages/warehouse/CountSessionsPage'

// Pages — Reports
import { ReportsPage } from '@/pages/reports/ReportsPage'
import { AnalyticsPage } from '@/pages/reports/AnalyticsPage'
import { CostCenterPage } from '@/pages/reports/CostCenterPage'
import { ManagementSummaryPage } from '@/pages/reports/ManagementSummaryPage'
import { ExportCenterPage } from '@/pages/reports/ExportCenterPage'

// Pages — Purchasing
import { PurchasingPage } from '@/pages/purchasing/PurchasingPage'
import { SuppliersPage } from '@/pages/purchasing/SuppliersPage'
import { PurchaseOrdersPage } from '@/pages/purchasing/PurchaseOrdersPage'
import { InvoicesPage } from '@/pages/purchasing/InvoicesPage'
import { ReorderPage } from '@/pages/purchasing/ReorderPage'

// Pages — Recipes
import { RecipesPage } from '@/pages/RecipesPage'

// Pages — Guestlist
import { GuestlistPage } from '@/pages/guestlist/GuestlistPage'
import { PromotersPage } from '@/pages/guestlist/PromotersPage'
import { DoorPage } from '@/pages/guestlist/DoorPage'
import { TicketClassesPage } from '@/pages/guestlist/TicketClassesPage'

// Pages — Setup
import { SetupVenuesPage } from '@/pages/setup/SetupVenuesPage'
import { SetupBarsPage } from '@/pages/setup/SetupBarsPage'
import { SetupStationsPage } from '@/pages/setup/SetupStationsPage'
import { SetupItemsPage } from '@/pages/setup/SetupItemsPage'
import { SetupStaffPage } from '@/pages/setup/SetupStaffPage'
import { SetupRolesPage } from '@/pages/setup/SetupRolesPage'
import { SetupUnitsPage } from '@/pages/setup/SetupUnitsPage'

// Pages — Settings
import { BusinessSettingsPage } from '@/pages/settings/BusinessSettingsPage'
import { TerminologyPage } from '@/pages/settings/TerminologyPage'
import { DevicesPage } from '@/pages/settings/DevicesPage'
import { FeatureFlagsPage } from '@/pages/settings/FeatureFlagsPage'
import { ProfilePage } from '@/pages/settings/ProfilePage'
import { DiagnosticsPage } from '@/pages/settings/DiagnosticsPage'
import { SyncConflictsPage } from '@/pages/settings/SyncConflictsPage'
import { AuditLogPage } from '@/pages/settings/AuditLogPage'

// Error pages
import { NotFoundPage } from '@/pages/NotFoundPage'

export const router = createBrowserRouter([
  {
    element: <RootLayout />,
    children: [
      // ─── Unauthenticated only ─────────────────────────────
      {
        element: <AuthLayout />,
        children: [
          { path: '/login', element: <LoginPage /> },
        ],
      },

      // ─── Authenticated, venue selection ──────────────────
      {
        element: <RequireAuth />,
        children: [
          { path: '/select-venue', element: <SelectVenuePage /> },

          // ─── Authenticated + venue selected ──────────────
          {
            element: <RequireVenue />,
            children: [
              {
                element: <AppLayout />,
                children: [
                  { path: '/', element: <Navigate to="/dashboard" replace /> },
                  { path: '/dashboard', element: <DashboardPage /> },

                  // Operations
                  { path: '/operations/submit-event', element: <SubmitEventPage /> },
                  { path: '/operations/events',       element: <EventsLogPage /> },
                  { path: '/operations/my-history',   element: <MyHistoryPage /> },
                  {
                    path: '/operations/nights',
                    element: <RequireRole minRole="manager"><NightsPage /></RequireRole>,
                  },
                  {
                    path: '/operations/placements',
                    element: <RequireRole minRole="manager"><PlacementsPage /></RequireRole>,
                  },

                  // Inventory
                  { path: '/inventory/clicker',    element: <InventoryClickerPage /> },
                  {
                    path: '/inventory/par-levels',
                    element: <RequireRole minRole="manager"><ParLevelsPage /></RequireRole>,
                  },
                  {
                    path: '/inventory/transfers',
                    element: <RequireRole minRole="manager"><TransfersPage /></RequireRole>,
                  },
                  { path: '/inventory/waste',     element: <WastePage /> },
                  {
                    path: '/inventory/variance',
                    element: <RequireRole minRole="manager"><VariancePage /></RequireRole>,
                  },

                  // Warehouse
                  {
                    path: '/warehouse',
                    element: <RequireRole minRole="manager"><WarehousePage /></RequireRole>,
                  },
                  {
                    path: '/warehouse/stock',
                    element: <RequireRole minRole="manager"><WarehouseStockPage /></RequireRole>,
                  },
                  {
                    path: '/warehouse/movements',
                    element: <RequireRole minRole="manager"><WarehouseMovementsPage /></RequireRole>,
                  },
                  {
                    path: '/warehouse/adjustments',
                    element: <RequireRole minRole="manager"><WarehouseAdjustmentsPage /></RequireRole>,
                  },
                  {
                    path: '/warehouse/snapshots',
                    element: <RequireRole minRole="manager"><WarehouseSnapshotsPage /></RequireRole>,
                  },
                  {
                    path: '/warehouse/count-sessions',
                    element: <CountSessionsPage />,
                  },

                  // Reports
                  {
                    path: '/reports',
                    element: <RequireRole minRole="finance"><ReportsPage /></RequireRole>,
                  },
                  {
                    path: '/reports/analytics',
                    element: <RequireRole minRole="finance"><AnalyticsPage /></RequireRole>,
                  },
                  {
                    path: '/reports/cost-center',
                    element: <RequireRole minRole="finance"><CostCenterPage /></RequireRole>,
                  },
                  {
                    path: '/reports/management-summary',
                    element: <RequireRole minRole="finance"><ManagementSummaryPage /></RequireRole>,
                  },
                  {
                    path: '/reports/export-center',
                    element: <RequireRole minRole="finance"><ExportCenterPage /></RequireRole>,
                  },

                  // Purchasing
                  {
                    path: '/purchasing',
                    element: <RequireRole minRole="finance"><PurchasingPage /></RequireRole>,
                  },
                  {
                    path: '/purchasing/suppliers',
                    element: <RequireRole minRole="finance"><SuppliersPage /></RequireRole>,
                  },
                  {
                    path: '/purchasing/purchase-orders',
                    element: <RequireRole minRole="finance"><PurchaseOrdersPage /></RequireRole>,
                  },
                  {
                    path: '/purchasing/invoices',
                    element: <RequireRole minRole="finance"><InvoicesPage /></RequireRole>,
                  },
                  {
                    path: '/purchasing/reorder',
                    element: <RequireRole minRole="finance"><ReorderPage /></RequireRole>,
                  },

                  // Recipes
                  {
                    path: '/recipes',
                    element: <RequireRole minRole="co_admin"><RecipesPage /></RequireRole>,
                  },

                  // Guestlist
                  {
                    path: '/guestlist',
                    element: <RequireRole minRole="door"><GuestlistPage /></RequireRole>,
                  },
                  {
                    path: '/guestlist/promoters',
                    element: <RequireRole minRole="manager"><PromotersPage /></RequireRole>,
                  },
                  {
                    path: '/guestlist/door',
                    element: <RequireRole minRole="door"><DoorPage /></RequireRole>,
                  },
                  {
                    path: '/guestlist/ticket-classes',
                    element: <RequireRole minRole="manager"><TicketClassesPage /></RequireRole>,
                  },

                  // Setup (org-level admin only)
                  {
                    path: '/setup/venues',
                    element: <RequireRole minRole="admin"><SetupVenuesPage /></RequireRole>,
                  },
                  {
                    path: '/setup/bars',
                    element: <RequireRole minRole="co_admin"><SetupBarsPage /></RequireRole>,
                  },
                  {
                    path: '/setup/stations',
                    element: <RequireRole minRole="co_admin"><SetupStationsPage /></RequireRole>,
                  },
                  {
                    path: '/setup/items',
                    element: <RequireRole minRole="co_admin"><SetupItemsPage /></RequireRole>,
                  },
                  {
                    path: '/setup/staff',
                    element: <RequireRole minRole="co_admin"><SetupStaffPage /></RequireRole>,
                  },
                  {
                    path: '/setup/roles',
                    element: <RequireRole minRole="admin"><SetupRolesPage /></RequireRole>,
                  },
                  {
                    path: '/setup/units',
                    element: <RequireRole minRole="co_admin"><SetupUnitsPage /></RequireRole>,
                  },

                  // Settings
                  {
                    path: '/settings/business',
                    element: <RequireRole minRole="admin"><BusinessSettingsPage /></RequireRole>,
                  },
                  { path: '/settings/terminology', element: <TerminologyPage /> },
                  { path: '/settings/devices',     element: <DevicesPage /> },
                  {
                    path: '/settings/feature-flags',
                    element: <RequireRole minRole="admin"><FeatureFlagsPage /></RequireRole>,
                  },
                  { path: '/settings/profile',     element: <ProfilePage /> },
                  {
                    path: '/settings/diagnostics',
                    element: <RequireRole minRole="manager"><DiagnosticsPage /></RequireRole>,
                  },
                  {
                    path: '/settings/diagnostics/sync-conflicts',
                    element: <RequireRole minRole="manager"><SyncConflictsPage /></RequireRole>,
                  },
                  {
                    path: '/settings/diagnostics/audit-log',
                    element: <RequireRole minRole="admin"><AuditLogPage /></RequireRole>,
                  },
                ],
              },
            ],
          },
        ],
      },

      // ─── 404 ────────────────────────────────────────────
      { path: '*', element: <NotFoundPage /> },
    ],
  },
])
