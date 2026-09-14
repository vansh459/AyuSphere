"use client";

/**
 * PWA install banner (T6.13) — phones only, session-only dismissal.
 * Android (Chromium): captures `beforeinstallprompt` and offers the native
 * install dialog. iPhone (Safari has NO install API): shows the real path —
 * Share → Add to Home Screen — never a fake install button.
 * Never renders on desktop/iPad/tablets (src/lib/device.ts) or when already
 * running standalone. Dismissal is plain state by design: a refresh remounts
 * the component and the banner may return (no storage persistence).
 */
import { useEffect, useState } from "react";
import { Share, SquarePlus, X } from "lucide-react";
import { isAndroidPhone, isIPhone, isStandalone } from "@/lib/device";
import { Button } from "@/components/ui/button";

/** Chromium-only event; not in lib.dom */
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export function InstallBanner() {
  const [platform, setPlatform] = useState<"android" | "iphone" | null>(null);
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // effect-only detection: SSR and hydration render nothing
    if (isStandalone()) return;
    if (isIPhone()) {
      setPlatform("iphone");
      return;
    }
    if (!isAndroidPhone()) return;
    setPlatform("android");
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  // Android shows only once Chrome offered installability (deferred captured);
  // browsers that never fire the event (Firefox, already installed) show nothing
  const visible =
    !dismissed &&
    (platform === "iphone" || (platform === "android" && deferred !== null));
  if (!visible) return null;

  async function install() {
    if (!deferred) return;
    await deferred.prompt();
    const choice = await deferred.userChoice;
    if (choice.outcome === "accepted") setDismissed(true);
    setDeferred(null); // the event is single-use either way
  }

  return (
    <div
      role="region"
      aria-label="Install app"
      className="clay fixed inset-x-3 bottom-3 z-30 flex items-center gap-3 p-4 print:hidden"
    >
      <div className="min-w-0 flex-1">
        <p className="font-bold">Get the AyuSphere app</p>
        {platform === "android" ? (
          <p className="opacity-70">
            Install it on your home screen — full screen, one tap away.
          </p>
        ) : (
          <p className="opacity-70">
            Tap <Share aria-label="Share" className="inline h-4 w-4 align-text-bottom text-primary" />{" "}
            <b>Share</b>, then{" "}
            <SquarePlus aria-label="Add to Home Screen" className="inline h-4 w-4 align-text-bottom text-primary" />{" "}
            <b>Add to Home Screen</b>.
          </p>
        )}
      </div>
      {platform === "android" ? (
        <Button size="sm" onClick={install}>
          Install
        </Button>
      ) : null}
      <button
        type="button"
        aria-label="Dismiss install banner"
        onClick={() => setDismissed(true)}
        className="rounded-lg p-1.5 opacity-60 transition-colors duration-200 hover:bg-primary-soft hover:opacity-100"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
