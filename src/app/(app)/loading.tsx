/**
 * Route-group loading UI (T6.11) — the App Router shows this INSTANTLY on
 * every navigation inside (app) while the target page's server render (DB
 * queries) is still running, so a sidebar click always paints immediately.
 * Deliberately coarse (header + card stack) so it never rots when a page's
 * layout changes; the dashboard has its own closer-shaped loading.tsx.
 */
import { Skeleton, SkeletonCard } from "@/components/app/skeleton";

export default function AppLoading() {
  return (
    <div
      role="status"
      aria-label="Loading"
      aria-busy="true"
      className="flex flex-col gap-6"
    >
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <SkeletonCard lines={4} />
      <SkeletonCard lines={3} />
      <SkeletonCard lines={3} />
    </div>
  );
}
