/**
 * Loading-skeleton primitives (T6.11, docs/loading-skeletons.md).
 * Design-system compliant by construction: clay surfaces (D-007), token
 * colors only, no text-size utilities (bars are sized with height/width, D-008),
 * and the shimmer is opacity-only `animate-pulse` (same precedent as the
 * breached escalation clock) — safe under prefers-reduced-motion.
 */
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/** one shimmering bar/block — size it with h-* and w-* utilities */
export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden
      className={cn("animate-pulse rounded-lg bg-line/60", className)}
      {...props}
    />
  );
}

/** a clay card shell: title bar + content lines */
export function SkeletonCard({
  lines = 3,
  className,
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <Card className={cn("flex flex-col gap-3", className)}>
      <Skeleton className="h-5 w-44" />
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton
          key={i}
          className={cn("h-4", i % 2 === 0 ? "w-full" : "w-3/4")}
        />
      ))}
    </Card>
  );
}
