import { EmptyState } from "@/components/ui/EmptyState"

export function SuppliersPage() {
  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-100 mb-6">Suppliers</h1>
      <EmptyState
        icon="🚧"
        title="Coming soon"
        description="This page will be implemented in a future phase."
      />
    </div>
  )
}
