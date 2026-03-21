import { EmptyState } from "@/components/ui/EmptyState"

export function DoorPage() {
  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-100 mb-6">Door</h1>
      <EmptyState
        icon="🚧"
        title="Coming soon"
        description="This page will be implemented in a future phase."
      />
    </div>
  )
}
