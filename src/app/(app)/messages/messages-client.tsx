"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Paperclip, Send, X } from "lucide-react";
import { fadeRise } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/app/shared";

const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024;
const POLL_MS = 5000;

export type ContactRow = {
  id: string;
  name: string;
  role: string;
  unreadCount: number;
  lastMessageAt: string | null;
};

type Message = {
  id: string;
  senderId: string;
  recipientId: string;
  body: string;
  attachmentUrl: string | null;
  attachmentName: string | null;
  attachmentType: string | null;
  createdAt: string;
};

const ROLE_LABEL: Record<string, string> = {
  pi: "PI",
  coordinator: "Coordinator",
  monitor: "Monitor",
  ethics: "Ethics",
  pv: "PV",
  admin: "Admin",
  regulator: "Regulator",
};

function timeLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleString([], {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      });
}

/** tolerant parse: platform-level failures (e.g. 413) return plain text */
async function parseResponse<T>(res: Response): Promise<T & { error?: string }> {
  const raw = await res.text();
  try {
    return JSON.parse(raw) as T & { error?: string };
  } catch {
    return {} as T & { error?: string };
  }
}

function Attachment({ m }: { m: Message }) {
  if (!m.attachmentUrl) return null;
  if (m.attachmentType?.startsWith("image/")) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={m.attachmentUrl}
        alt={m.attachmentName ?? "shared image"}
        className="mt-2 max-h-64 w-full rounded-xl object-contain"
      />
    );
  }
  return (
    <a
      href={m.attachmentUrl}
      download={m.attachmentName ?? true}
      target="_blank"
      rel="noreferrer"
      className="mt-2 flex items-center gap-2 rounded-xl border border-line/40 bg-black/5 px-3 py-2 font-medium underline-offset-2 hover:underline"
    >
      <Paperclip className="h-4 w-4 shrink-0" />
      <span className="min-w-0 truncate">{m.attachmentName ?? "attachment"}</span>
    </a>
  );
}

export function MessagesClient({
  selfId,
  initialContacts,
}: {
  selfId: string;
  initialContacts: ContactRow[];
}) {
  const [contactList, setContactList] = useState<ContactRow[]>(initialContacts);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [thread, setThread] = useState<Message[]>([]);
  const [loadingThread, setLoadingThread] = useState(false);
  const [draft, setDraft] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const activeIdRef = useRef<string | null>(null);
  activeIdRef.current = activeId;

  const active = contactList.find((c) => c.id === activeId) ?? null;

  const refresh = useCallback(async (withUserId: string | null) => {
    try {
      const url = withUserId
        ? `/api/messages?with=${encodeURIComponent(withUserId)}`
        : "/api/messages";
      const res = await fetch(url);
      if (!res.ok) return;
      const json = await parseResponse<{
        messages?: Message[];
        contacts?: ContactRow[];
      }>(res);
      // ignore stale responses after the user switched threads
      if (activeIdRef.current !== withUserId) return;
      if (json.contacts) setContactList(json.contacts);
      if (withUserId && json.messages) setThread(json.messages);
    } catch {
      /* transient poll failure — next tick retries */
    }
  }, []);

  // open a thread
  useEffect(() => {
    if (!activeId) return;
    let cancelled = false;
    setLoadingThread(true);
    setThread([]);
    setError(null);
    void (async () => {
      await refresh(activeId);
      if (!cancelled) setLoadingThread(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [activeId, refresh]);

  // poll the open thread + contact unread counts every 5s
  useEffect(() => {
    const t = setInterval(() => void refresh(activeIdRef.current), POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  // keep the newest message in view
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [thread.length, activeId]);

  function pickFile(f: File | null) {
    setError(null);
    if (!f) {
      setFile(null);
      return;
    }
    if (!f.type.startsWith("image/") && f.size > MAX_ATTACHMENT_BYTES) {
      setError("That file is over 2MB — please share a smaller file.");
      return;
    }
    setFile(f);
  }

  async function send() {
    if (!active || sending) return;
    if (!draft.trim() && !file) return;
    setSending(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("recipientId", active.id);
      form.set("body", draft.trim());
      if (file) {
        let toSend = file;
        if (file.type.startsWith("image/")) {
          const { prepareImageForUpload } = await import("@/lib/image");
          toSend = await prepareImageForUpload(file);
        }
        if (toSend.size > MAX_ATTACHMENT_BYTES) {
          throw new Error(
            "That file is over 2MB even after compression — please share a smaller one.",
          );
        }
        form.set("file", toSend);
      }
      const res = await fetch("/api/messages", { method: "POST", body: form });
      const json = await parseResponse<{ message?: Message }>(res);
      if (!res.ok) {
        throw new Error(
          json.error ??
            (res.status === 413
              ? "The attachment is too large to upload (max 2MB)."
              : `send failed (HTTP ${res.status})`),
        );
      }
      if (json.message) setThread((t) => [...t, json.message!]);
      setDraft("");
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      void refresh(active.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "send failed");
    } finally {
      setSending(false);
    }
  }

  if (contactList.length === 0) {
    return <EmptyState message="No other users on the platform yet." />;
  }

  return (
    <div className="clay flex h-[calc(100vh-14rem)] min-h-[420px] overflow-hidden p-0">
      {/* contact list */}
      <div
        className={cn(
          "flex w-full shrink-0 flex-col border-r border-line md:w-72",
          activeId && "max-md:hidden",
        )}
      >
        <p className="microlabel border-b border-line px-4 py-3">People</p>
        <div className="flex flex-1 flex-col overflow-y-auto">
          {contactList.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setActiveId(c.id)}
              className={cn(
                "flex items-center gap-3 border-b border-line px-4 py-3 text-left transition-colors duration-200",
                activeId === c.id ? "bg-primary-soft" : "hover:bg-bg",
              )}
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary font-bold text-white">
                {c.name
                  .split(" ")
                  .map((w) => w[0])
                  .slice(0, 2)
                  .join("")
                  .toUpperCase()}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="min-w-0 truncate font-medium">{c.name}</span>
                  <Badge tone="neutral">{ROLE_LABEL[c.role] ?? c.role}</Badge>
                </span>
                {c.lastMessageAt ? (
                  <span suppressHydrationWarning className="block truncate opacity-50">
                    {timeLabel(c.lastMessageAt)}
                  </span>
                ) : null}
              </span>
              {c.unreadCount > 0 ? (
                <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-danger px-1 font-bold text-white">
                  {c.unreadCount > 9 ? "9+" : c.unreadCount}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      </div>

      {/* thread */}
      <div className={cn("flex min-w-0 flex-1 flex-col", !activeId && "max-md:hidden")}>
        {!active ? (
          <div className="flex flex-1 items-center justify-center">
            <p className="opacity-50">Select a person to start chatting.</p>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 border-b border-line px-4 py-3">
              <button
                type="button"
                onClick={() => setActiveId(null)}
                className="opacity-70 transition-opacity hover:opacity-100 md:hidden"
                aria-label="Back to contacts"
              >
                ←
              </button>
              <p className="font-bold">{active.name}</p>
              <Badge tone="neutral">{ROLE_LABEL[active.role] ?? active.role}</Badge>
            </div>

            <div className="flex flex-1 flex-col gap-2 overflow-y-auto px-4 py-4">
              {loadingThread ? (
                <p className="opacity-50">Loading conversation…</p>
              ) : thread.length === 0 ? (
                <p className="opacity-50">
                  No messages yet — say hello, or share a document.
                </p>
              ) : (
                <AnimatePresence initial={false}>
                  {thread.map((m) => {
                    const own = m.senderId === selfId;
                    return (
                      <motion.div
                        key={m.id}
                        variants={fadeRise}
                        initial="hidden"
                        animate="visible"
                        className={cn(
                          "flex w-full",
                          own ? "justify-end" : "justify-start",
                        )}
                      >
                        <div
                          className={cn(
                            "max-w-[75%] rounded-2xl px-3.5 py-2.5",
                            own
                              ? "bg-primary text-white"
                              : "clay-btn border border-line",
                          )}
                        >
                          {m.body ? (
                            <p className="whitespace-pre-wrap break-words">
                              {m.body}
                            </p>
                          ) : null}
                          <Attachment m={m} />
                          <p
                            suppressHydrationWarning
                            className={cn(
                              "mt-1 text-right",
                              own ? "text-white/60" : "opacity-50",
                            )}
                          >
                            {timeLabel(m.createdAt)}
                          </p>
                        </div>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              )}
              <div ref={bottomRef} />
            </div>

            {error ? (
              <p role="alert" className="px-4 pb-1 text-danger">
                {error}
              </p>
            ) : null}
            {file ? (
              <div className="mx-4 mb-1 flex items-center gap-2 rounded-xl border border-line bg-bg px-3 py-1.5">
                <Paperclip className="h-4 w-4 shrink-0 text-primary" />
                <span className="min-w-0 flex-1 truncate">{file.name}</span>
                <button
                  type="button"
                  onClick={() => {
                    setFile(null);
                    if (fileInputRef.current) fileInputRef.current.value = "";
                  }}
                  className="opacity-60 hover:opacity-100"
                  aria-label="Remove attachment"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : null}

            <form
              className="flex items-center gap-2 border-t border-line px-4 py-3"
              onSubmit={(e) => {
                e.preventDefault();
                void send();
              }}
            >
              <label
                className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-line transition-colors duration-200 hover:border-primary"
                aria-label="Attach a file"
              >
                <Paperclip className="h-4 w-4 opacity-70" />
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
                />
              </label>
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={`Message ${active.name}…`}
                maxLength={4000}
                className="h-10 min-w-0 flex-1 rounded-xl border border-line bg-surface px-3 outline-none focus:border-primary"
              />
              <button
                type="submit"
                disabled={sending || (!draft.trim() && !file)}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-white transition-transform duration-200 hover:-translate-y-[2px] disabled:translate-y-0 disabled:opacity-50"
                aria-label="Send message"
              >
                <Send className="h-4 w-4" />
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
