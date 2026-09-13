"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface UnreadMessage {
  id: string;
  senderId: string;
  senderName: string;
  senderRole: string;
  body: string;
  attachmentName: string | null;
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

function MessageToastInner() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeWith = searchParams.get("with");

  const [message, setMessage] = useState<UnreadMessage | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const dismissedIdsRef = useRef<Set<string>>(new Set());
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const checkUnread = async () => {
    try {
      const res = await fetch("/api/messages/latest-unread");
      if (!res.ok) return;
      const data = await res.json();
      const unread: UnreadMessage | null = data.message;

      if (!unread) return;
      if (dismissedIdsRef.current.has(unread.id)) return;

      // Skip toast if user is actively reading this exact thread in /messages
      if (pathname === "/messages" && activeWith === unread.senderId) {
        return;
      }

      setMessage(unread);
      setIsVisible(true);

      // Auto dismiss after 6 seconds if not hovered
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        setIsVisible(false);
      }, 6000);
    } catch {
      // transient poll failure
    }
  };

  useEffect(() => {
    // Initial check after 3 seconds, then poll every 8 seconds
    const initial = setTimeout(checkUnread, 3000);
    const interval = setInterval(checkUnread, 8000);
    return () => {
      clearTimeout(initial);
      clearInterval(interval);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [pathname, activeWith]);

  const handleDismiss = () => {
    if (message) dismissedIdsRef.current.add(message.id);
    setIsVisible(false);
    if (timerRef.current) clearTimeout(timerRef.current);
  };

  const handleReply = () => {
    if (!message) return;
    dismissedIdsRef.current.add(message.id);
    setIsVisible(false);
    router.push(`/messages?with=${encodeURIComponent(message.senderId)}`);
  };

  const handleMouseEnter = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  };

  const handleMouseLeave = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setIsVisible(false);
    }, 3500);
  };

  if (!message) return null;

  const initials = (message.senderName || "?")
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const roleDisplay = ROLE_LABEL[message.senderRole] || message.senderRole;
  const contentSnippet = message.body
    ? message.body
    : message.attachmentName
      ? `Shared attachment: ${message.attachmentName}`
      : "Sent a new message";

  return (
    <aside
      aria-live="polite"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={cn(
        "fixed right-4 top-16 z-50 w-84 max-w-[calc(100vw-32px)] md:right-6 md:w-92",
        "rounded-2xl border border-line bg-surface p-4 shadow-xl transition-all duration-350 ease-[cubic-bezier(0.16,1,0.3,1)]",
        isVisible
          ? "translate-x-0 opacity-100 scale-100 pointer-events-auto"
          : "translate-x-10 opacity-0 scale-95 pointer-events-none",
      )}
    >
      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Dismiss notification"
        className="absolute right-3 top-3 cursor-pointer rounded-lg p-1 text-ink/40 transition-colors duration-150 hover:bg-primary-soft hover:text-ink"
      >
        <X className="h-4 w-4" />
      </button>

      <div className="flex gap-3">
        {/* Sender Avatar */}
        <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft font-bold text-primary">
          {initials}
          <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-surface bg-emerald-500" />
        </div>

        {/* Message Details */}
        <div className="min-w-0 flex-1 pr-3">
          <div className="flex items-center justify-between gap-1">
            <h4 className="truncate text-body font-bold text-ink">
              {message.senderName}
            </h4>
          </div>
          <p className="truncate text-[11.5px] font-medium text-ink/60">
            {roleDisplay}
          </p>

          <p className="mt-1 line-clamp-2 text-[13px] leading-snug text-ink/80">
            {contentSnippet}
          </p>

          {/* Action buttons */}
          <div className="mt-3 flex items-center gap-2">
            <Button
              size="sm"
              variant="primary"
              onClick={handleReply}
              className="h-7 px-3 text-[12px] font-semibold"
            >
              Reply
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={handleDismiss}
              className="h-7 px-2.5 text-[12px] text-ink/60 hover:text-ink"
            >
              Dismiss
            </Button>
          </div>
        </div>
      </div>
    </aside>
  );
}

export function MessageToast() {
  return (
    <Suspense fallback={null}>
      <MessageToastInner />
    </Suspense>
  );
}
