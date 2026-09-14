/**
 * Dashboard-shaped loading UI (T6.11) — the most-visited, heaviest page gets
 * shape parity (greeting → stat-tile grid → two chart cards) so the real
 * render lands with minimal layout shift.
 */
import { Card } from "@/components/ui/card";
import { Skeleton, SkeletonCard } from "@/components/app/skeleton";

export default function DashboardLoading() {
  return (
    <div
      role="status"
      aria-label="Loading dashboard"
      aria-busy="true"
      className="flex flex-col gap-6"
    >
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-72" />
        <Skeleton className="h-4 w-52" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Card key={i} className="flex flex-col gap-3">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-8 w-16" />
            <Skeleton className="h-3 w-28" />
          </Card>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="flex flex-col gap-3">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-48 w-full" />
        </Card>
        <Card className="flex flex-col gap-3">
          <Skeleton className="h-5 w-44" />
          <Skeleton className="h-48 w-full" />
        </Card>
      </div>
      <SkeletonCard lines={3} />
    </div>
  );
}
