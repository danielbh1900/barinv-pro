import { EmptyState } from "@/components/ui/EmptyState"

export function AuditLogPage() {
  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-100 mb-6">Audit Log</h1>
      <EmptyState
        icon="🚧"
        title="Coming soon"
        description="This page will be implemented in a future phase."
      />
    </div>
  )
}
