"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, Loader2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { acknowledgeAlertAction } from "@/app/(app)/alerts/actions";

interface UnreadMessage {
  id: string;
  senderId: string;
  senderName: string;
  senderRole: string;
  body: string;
  attachmentName: string | null;
  createdAt: string;
}

interface UnreadAlert {
  id: string;
  ruleKey: string;
  entityRef: string;
  severity: "danger" | "warning" | "info";
  message: string;
  createdAt: string;
}

const ROLE_LABEL: Record<string, string> = {
  pi: "Principal Investigator",
  coordinator: "Study Coordinator",
  monitor: "Monitor",
  ethics: "Ethics Committee",
  pv: "Pharmacovigilance",
  admin: "Administrator",
  regulator: "Regulator",
};

interface NotificationToastProps {
  canChat?: boolean;
  canAlerts?: boolean;
}

function NotificationToastInner({
  canChat = true,
  canAlerts = false,
}: NotificationToastProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeWith = searchParams.get("with");

  // Message state
  const [message, setMessage] = useState<UnreadMessage | null>(null);
  const [isMessageVisible, setIsMessageVisible] = useState(false);
  const shownMessagesRef = useRef<Set<string>>(new Set());
  const messageTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Alert state
  const [alert, setAlert] = useState<UnreadAlert | null>(null);
  const [isAlertVisible, setIsAlertVisible] = useState(false);
  const [isAcknowledging, setIsAcknowledging] = useState(false);
  const [isAcknowledged, setIsAcknowledged] = useState(false);
  const shownAlertsRef = useRef<Set<string>>(new Set());
  const alertTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Check if a message was already toasted in this session
  const isMessageAlreadyShown = (id: string) => {
    if (shownMessagesRef.current.has(id)) return true;
    try {
      return sessionStorage.getItem(`seen_toast_msg_${id}`) === "1";
    } catch {
      return false;
    }
  };

  const markMessageAsShown = (id: string) => {
    shownMessagesRef.current.add(id);
    try {
      sessionStorage.setItem(`seen_toast_msg_${id}`, "1");
    } catch {
      // ignore storage errors
    }
  };

  // Check if an alert was already toasted in this session
  const isAlertAlreadyShown = (id: string) => {
    if (shownAlertsRef.current.has(id)) return true;
    try {
      return sessionStorage.getItem(`seen_toast_alert_${id}`) === "1";
    } catch {
      return false;
    }
  };

  const markAlertAsShown = (id: string) => {
    shownAlertsRef.current.add(id);
    try {
      sessionStorage.setItem(`seen_toast_alert_${id}`, "1");
    } catch {
      // ignore storage errors
    }
  };

  // Poll for messages
  const checkUnreadMessages = async () => {
    if (!canChat) return;
    try {
      const res = await fetch("/api/messages/latest-unread", {
        cache: "no-store",
        headers: { "Cache-Control": "no-cache" },
      });
      if (!res.ok) return;
      const data = await res.json();
      const unread: UnreadMessage | null = data.message;

      if (!unread) return;
      // If this message was already toasted once, do not re-show it
      if (isMessageAlreadyShown(unread.id)) return;

      // Skip toast if user is actively viewing this exact conversation in /messages
      if (pathname === "/messages" && activeWith === unread.senderId) {
        markMessageAsShown(unread.id);
        return;
      }

      // Mark as shown so subsequent polls never re-trigger the same message
      markMessageAsShown(unread.id);
      setMessage(unread);
      setIsMessageVisible(true);

      if (messageTimerRef.current) clearTimeout(messageTimerRef.current);
      messageTimerRef.current = setTimeout(() => {
        setIsMessageVisible(false);
      }, 6000);
    } catch {
      // transient poll failure
    }
  };

  // Poll for critical safety / protocol alerts
  const checkUnreadAlerts = async () => {
    if (!canAlerts) return;
    // Suppress alert toasts if user is already on the alerts dashboard
    if (pathname === "/alerts") {
      setIsAlertVisible(false);
      return;
    }
    try {
      const res = await fetch("/api/alerts/latest-unread", {
        cache: "no-store",
        headers: { "Cache-Control": "no-cache" },
      });
      if (!res.ok) return;
      const data = await res.json();
      const latestAlert: UnreadAlert | null = data.alert;

      if (!latestAlert) return;
      // If this alert was already toasted once, do not re-show it
      if (isAlertAlreadyShown(latestAlert.id)) return;

      // Mark as shown so subsequent polls never re-trigger the same alert
      markAlertAsShown(latestAlert.id);
      setAlert(latestAlert);
      setIsAcknowledged(false);
      setIsAlertVisible(true);

      if (alertTimerRef.current) clearTimeout(alertTimerRef.current);
      alertTimerRef.current = setTimeout(() => {
        setIsAlertVisible(false);
      }, 7000);
    } catch {
      // transient poll failure
    }
  };

  useEffect(() => {
    if (canChat) {
      checkUnreadMessages();
      const interval = setInterval(checkUnreadMessages, 1200);

      const onFocus = () => checkUnreadMessages();
      window.addEventListener("focus", onFocus);
      document.addEventListener("visibilitychange", onFocus);

      let bc: BroadcastChannel | null = null;
      if (typeof BroadcastChannel !== "undefined") {
        try {
          bc = new BroadcastChannel("ayusphere_messages");
          bc.onmessage = () => checkUnreadMessages();
        } catch {
          // ignore
        }
      }

      return () => {
        clearInterval(interval);
        window.removeEventListener("focus", onFocus);
        document.removeEventListener("visibilitychange", onFocus);
        if (messageTimerRef.current) clearTimeout(messageTimerRef.current);
        if (bc) bc.close();
      };
    }
  }, [canChat, pathname, activeWith]);

  useEffect(() => {
    if (canAlerts) {
      checkUnreadAlerts();
      const interval = setInterval(checkUnreadAlerts, 2000);

      const onFocus = () => checkUnreadAlerts();
      window.addEventListener("focus", onFocus);
      document.addEventListener("visibilitychange", onFocus);

      let bc: BroadcastChannel | null = null;
      if (typeof BroadcastChannel !== "undefined") {
        try {
          bc = new BroadcastChannel("ayusphere_alerts");
          bc.onmessage = () => checkUnreadAlerts();
        } catch {
          // ignore
        }
      }

      return () => {
        clearInterval(interval);
        window.removeEventListener("focus", onFocus);
        document.removeEventListener("visibilitychange", onFocus);
        if (alertTimerRef.current) clearTimeout(alertTimerRef.current);
        if (bc) bc.close();
      };
    }
  }, [canAlerts, pathname]);

  // Message handlers
  const handleDismissMessage = () => {
    if (message) markMessageAsShown(message.id);
    setIsMessageVisible(false);
    if (messageTimerRef.current) clearTimeout(messageTimerRef.current);
  };

  const handleReplyMessage = () => {
    if (!message) return;
    markMessageAsShown(message.id);
    setIsMessageVisible(false);
    router.push(`/messages?with=${encodeURIComponent(message.senderId)}`);
  };

  // Alert handlers
  const handleDismissAlert = () => {
    if (alert) markAlertAsShown(alert.id);
    setIsAlertVisible(false);
    if (alertTimerRef.current) clearTimeout(alertTimerRef.current);
  };

  const handleReviewAlert = () => {
    if (alert) markAlertAsShown(alert.id);
    setIsAlertVisible(false);
    router.push("/alerts");
  };

  const handleAcknowledgeAlert = async () => {
    if (!alert || isAcknowledging || isAcknowledged) return;
    setIsAcknowledging(true);
    try {
      await acknowledgeAlertAction(alert.id);
      markAlertAsShown(alert.id);
      setIsAcknowledging(false);
      setIsAcknowledged(true);

      // Broadcast to other tabs
      if (typeof BroadcastChannel !== "undefined") {
        try {
          const bc = new BroadcastChannel("ayusphere_alerts");
          bc.postMessage({ type: "alert_acknowledged", id: alert.id });
          bc.close();
        } catch {
          // ignore
        }
      }

      // Brief reassurance before closing toast
      setTimeout(() => {
        setIsAlertVisible(false);
      }, 500);
    } catch {
      setIsAcknowledging(false);
    }
  };

  if (!isMessageVisible && !isAlertVisible) return null;

  return (
    <div
      aria-live="polite"
      className="fixed right-4 top-16 z-50 flex flex-col gap-3 pointer-events-none w-84 max-w-[calc(100vw-32px)] md:right-6 md:w-92"
    >
      {/* Alert Notification Card */}
      {alert && isAlertVisible && (
        <aside
          onMouseEnter={() => {
            if (alertTimerRef.current) clearTimeout(alertTimerRef.current);
          }}
          onMouseLeave={() => {
            if (alertTimerRef.current) clearTimeout(alertTimerRef.current);
            alertTimerRef.current = setTimeout(() => {
              setIsAlertVisible(false);
            }, 4000);
          }}
          className={cn(
            "relative rounded-2xl border p-4 shadow-xl transition-all duration-350 ease-[cubic-bezier(0.16,1,0.3,1)] pointer-events-auto",
            alert.severity === "danger"
              ? "border-danger/30 bg-surface shadow-danger/5"
              : "border-warning/30 bg-surface shadow-warning/5",
            isAcknowledged && "!border-primary/40 bg-primary-soft/40",
          )}
        >
          <button
            type="button"
            onClick={handleDismissAlert}
            aria-label="Dismiss alert"
            className="absolute right-3 top-3 cursor-pointer rounded-lg p-1 text-ink/40 transition-colors duration-150 hover:bg-primary-soft hover:text-ink"
          >
            <X className="h-4 w-4" />
          </button>

          <div className="flex gap-3">
            {/* Severity Icon */}
            <div
              className={cn(
                "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
                alert.severity === "danger"
                  ? "bg-danger/10 text-danger"
                  : "bg-warning/10 text-warning",
              )}
            >
              <AlertTriangle className="h-5 w-5" />
            </div>

            {/* Alert Details */}
            <div className="min-w-0 flex-1 pr-3">
              <div className="flex items-center gap-2">
                <Badge
                  tone={
                    alert.severity === "danger"
                      ? "danger"
                      : alert.severity === "warning"
                        ? "warning"
                        : "info"
                  }
                >
                  {alert.severity === "danger" ? "Critical" : "Warning"}
                </Badge>
                <span className="truncate text-body font-bold text-ink">
                  {alert.ruleKey.replace(/_/g, " ")}
                </span>
              </div>

              <p className="mt-1 line-clamp-2 text-body leading-snug text-ink/80">
                {alert.message}
              </p>

              {/* Action buttons */}
              <div className="mt-3 flex items-center gap-2">
                <Button
                  size="sm"
                  variant="primary"
                  onClick={handleReviewAlert}
                  className="h-7 px-3 font-semibold"
                >
                  Review
                </Button>
                <Button
                  size="sm"
                  variant={isAcknowledged ? "primary" : "outline"}
                  disabled={isAcknowledging || isAcknowledged}
                  onClick={handleAcknowledgeAlert}
                  className={cn(
                    "h-7 px-2.5 font-semibold transition-all duration-200",
                    isAcknowledged &&
                      "!opacity-100 pointer-events-none bg-primary text-white border-primary",
                  )}
                >
                  {isAcknowledging ? (
                    <span className="flex items-center gap-1">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Saving...
                    </span>
                  ) : isAcknowledged ? (
                    "Acknowledged"
                  ) : (
                    "Acknowledge"
                  )}
                </Button>
              </div>
            </div>
          </div>
        </aside>
      )}

      {/* Message Notification Card */}
      {message && isMessageVisible && (
        <aside
          onMouseEnter={() => {
            if (messageTimerRef.current) clearTimeout(messageTimerRef.current);
          }}
          onMouseLeave={() => {
            if (messageTimerRef.current) clearTimeout(messageTimerRef.current);
            messageTimerRef.current = setTimeout(() => {
              setIsMessageVisible(false);
            }, 3500);
          }}
          className="relative rounded-2xl border border-line bg-surface p-4 shadow-xl transition-all duration-350 ease-[cubic-bezier(0.16,1,0.3,1)] pointer-events-auto"
        >
          <button
            type="button"
            onClick={handleDismissMessage}
            aria-label="Dismiss message notification"
            className="absolute right-3 top-3 cursor-pointer rounded-lg p-1 text-ink/40 transition-colors duration-150 hover:bg-primary-soft hover:text-ink"
          >
            <X className="h-4 w-4" />
          </button>

          <div className="flex gap-3">
            {/* Sender Avatar */}
            <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft font-bold text-primary">
              {(message.senderName || "?")
                .split(" ")
                .map((w) => w[0])
                .slice(0, 2)
                .join("")
                .toUpperCase()}
              <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-surface bg-emerald-500" />
            </div>

            {/* Message Details */}
            <div className="min-w-0 flex-1 pr-3">
              <h4 className="truncate text-body font-bold text-ink">
                {message.senderName}
              </h4>
              <p className="truncate font-medium opacity-60">
                {ROLE_LABEL[message.senderRole] || message.senderRole}
              </p>

              <p className="mt-1 line-clamp-2 text-body leading-snug text-ink/80">
                {message.body
                  ? message.body
                  : message.attachmentName
                    ? `Shared attachment: ${message.attachmentName}`
                    : "Sent a new message"}
              </p>

              {/* Action buttons */}
              <div className="mt-3 flex items-center gap-2">
                <Button
                  size="sm"
                  variant="primary"
                  onClick={handleReplyMessage}
                  className="h-7 px-3 font-semibold"
                >
                  Reply
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleDismissMessage}
                  className="h-7 px-2.5 opacity-60 hover:opacity-100"
                >
                  Dismiss
                </Button>
              </div>
            </div>
          </div>
        </aside>
      )}
    </div>
  );
}

export function NotificationToast(props: NotificationToastProps) {
  return (
    <Suspense fallback={null}>
      <NotificationToastInner {...props} />
    </Suspense>
  );
}

// Retain backwards-compatible export
export function MessageToast(props: NotificationToastProps) {
  return <NotificationToast {...props} />;
}
