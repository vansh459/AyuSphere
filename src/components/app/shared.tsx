import Link from "next/link";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-heading font-bold">{title}</h1>
        {subtitle ? <p className="mt-1 opacity-70">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function ErrorBanner({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-danger"
    >
      {message}
    </div>
  );
}

export function EmptyState({
  message,
  action,
}: {
  message: string;
  action?: React.ReactNode;
}) {
  return (
    <Card className="flex flex-col items-start gap-3">
      <p className="opacity-70">{message}</p>
      {action}
    </Card>
  );
}

export function DbErrorState() {
  return (
    <Card>
      <p className="text-warning font-medium">
        Database not configured — set DATABASE_URL and run the seed.
      </p>
    </Card>
  );
}

const STATUS_TONE: Record<string, string> = {
  // trials
  draft: "bg-primary-soft text-primary-deep",
  iec_review: "bg-info/10 text-info",
  iec_approved: "bg-success/10 text-success",
  ctri_registered: "bg-success/10 text-success",
  active: "bg-success/10 text-success",
  enrolment_closed: "bg-warning/10 text-warning",
  followup: "bg-info/10 text-info",
  closeout: "bg-primary-soft text-primary-deep",
  // participants / visits / entries
  screening: "bg-info/10 text-info",
  enrolled: "bg-success/10 text-success",
  withdrawn: "bg-danger/10 text-danger",
  completed: "bg-success/10 text-success",
  upcoming: "bg-primary-soft text-primary-deep",
  due: "bg-info/10 text-info",
  overdue: "bg-warning/10 text-warning",
  missed: "bg-danger/10 text-danger",
  cancelled: "bg-primary-soft text-primary-deep",
  submitted: "bg-info/10 text-info",
  approved: "bg-success/10 text-success",
  superseded: "bg-primary-soft text-primary-deep",
  pending: "bg-primary-soft text-primary-deep",
  passed: "bg-success/10 text-success",
  failed: "bg-danger/10 text-danger",
  given: "bg-success/10 text-success",
  not_taken: "bg-warning/10 text-warning",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 font-medium",
        STATUS_TONE[status] ?? "bg-primary-soft text-primary-deep",
      )}
    >
      {status.replaceAll("_", " ")}
    </span>
  );
}

export function ProgressBar({ value }: { value: number }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-28 overflow-hidden rounded-full bg-primary-soft">
        <div
          className="h-full rounded-full bg-primary transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="opacity-70">{pct}%</span>
    </div>
  );
}

export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="opacity-70 transition-opacity hover:opacity-100">
      ← {label}
    </Link>
  );
}
