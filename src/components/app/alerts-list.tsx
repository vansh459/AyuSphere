"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { acknowledgeAlertAction } from "@/app/(app)/alerts/actions";
import type { alerts } from "@/db/schema";

const TONE = {
  info: "info",
  warning: "warning",
  danger: "danger",
} as const;

type AlertItem = typeof alerts.$inferSelect;

interface AlertsListProps {
  initialAlerts: AlertItem[];
}

export function AlertsList({ initialAlerts }: AlertsListProps) {
  const [alertList, setAlertList] = useState<AlertItem[]>(initialAlerts);
  const [submittingIds, setSubmittingIds] = useState<Record<string, boolean>>({});
  const [confirmedIds, setConfirmedIds] = useState<Record<string, boolean>>({});
  const [collapsingIds, setCollapsingIds] = useState<Record<string, boolean>>({});

  async function handleAcknowledge(id: string) {
    if (submittingIds[id] || confirmedIds[id]) return;

    setSubmittingIds((prev) => ({ ...prev, [id]: true }));

    try {
      await acknowledgeAlertAction(id);

      // Transition to confirmed state (clean text 'Acknowledged' with no tick mark, green tint)
      setSubmittingIds((prev) => ({ ...prev, [id]: false }));
      setConfirmedIds((prev) => ({ ...prev, [id]: true }));

      // 300ms reassurance window so the user clearly registers success
      setTimeout(() => {
        setCollapsingIds((prev) => ({ ...prev, [id]: true }));

        // 250ms smooth height collapse & slide out
        setTimeout(() => {
          setAlertList((prev) => prev.filter((a) => a.id !== id));
          setConfirmedIds((prev) => {
            const next = { ...prev };
            delete next[id];
            return next;
          });
          setCollapsingIds((prev) => {
            const next = { ...prev };
            delete next[id];
            return next;
          });
        }, 250);
      }, 300);
    } catch {
      setSubmittingIds((prev) => ({ ...prev, [id]: false }));
    }
  }

  if (alertList.length === 0) {
    return (
      <Card>
        <p className="opacity-70">
          No open alerts. The rules engine re-evaluates on every write and
          every 10 minutes.
        </p>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {alertList.map((a) => {
        const isSubmitting = submittingIds[a.id];
        const isConfirmed = confirmedIds[a.id];
        const isCollapsing = collapsingIds[a.id];

        return (
          <div
            key={a.id}
            className={cn(
              "overflow-hidden transition-all duration-250 ease-[cubic-bezier(0.4,0,0.2,1)]",
              isCollapsing
                ? "max-h-0 opacity-0 scale-[0.98] py-0 my-0 border-0"
                : "max-h-48 opacity-100 scale-100",
            )}
          >
            <Card
              className={cn(
                "flex flex-wrap items-center justify-between gap-3 p-4 transition-all duration-300",
                isConfirmed && "border-primary/40 bg-primary-soft/50 shadow-xs",
              )}
            >
              <div className="flex min-w-0 items-center gap-3">
                <Badge tone={TONE[a.severity]}>{a.severity}</Badge>
                <div className="min-w-0">
                  <p
                    className={cn(
                      "font-medium transition-all duration-300",
                      isConfirmed && "line-through opacity-60 text-ink/70",
                    )}
                  >
                    {a.message}
                  </p>
                  <p className="opacity-50">
                    {a.ruleKey} · {new Date(a.createdAt).toLocaleString()}
                  </p>
                </div>
              </div>
              <Button
                variant={isConfirmed ? "primary" : "outline"}
                size="sm"
                disabled={isSubmitting || isConfirmed}
                onClick={() => handleAcknowledge(a.id)}
                className={cn(
                  "min-w-[116px] shrink-0 font-semibold transition-all duration-300",
                  isConfirmed &&
                    "!opacity-100 pointer-events-none bg-primary text-white border-primary shadow-xs",
                )}
              >
                {isSubmitting ? (
                  <span className="flex items-center gap-1.5">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Saving...
                  </span>
                ) : isConfirmed ? (
                  "Acknowledged"
                ) : (
                  "Acknowledge"
                )}
              </Button>
            </Card>
          </div>
        );
      })}
    </div>
  );
}
