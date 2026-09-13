"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  AlertTriangle,
  Bell,
  Bot,
  Calendar,
  ClipboardList,
  Download,
  FileText,
  FlaskConical,
  History,
  Home,
  Leaf,
  MapPin,
  MessageSquare,
  ScanLine,
  Settings,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { NavItem } from "@/lib/nav";

const ICONS: Record<NavItem["icon"], React.ComponentType<{ className?: string }>> = {
  home: Home,
  flask: FlaskConical,
  users: Users,
  "map-pin": MapPin,
  calendar: Calendar,
  clipboard: ClipboardList,
  "alert-triangle": AlertTriangle,
  message: MessageSquare,
  scan: ScanLine,
  bell: Bell,
  bot: Bot,
  "file-text": FileText,
  download: Download,
  history: History,
  settings: Settings,
};

export function Sidebar({
  items,
  badges,
}: {
  items: NavItem[];
  badges?: Record<string, number>;
}) {
  const pathname = usePathname();
  const navRef = useRef<HTMLElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [thumbHeight, setThumbHeight] = useState(0);
  const [thumbTop, setThumbTop] = useState(0);
  const [isVisible, setIsVisible] = useState(false);
  const hideTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isDraggingRef = useRef(false);
  const dragStartYRef = useRef(0);
  const dragStartScrollTopRef = useRef(0);

  const updateGeometry = useCallback(() => {
    const el = navRef.current;
    if (!el) return;
    const { clientHeight, scrollHeight, scrollTop } = el;
    if (scrollHeight <= clientHeight + 1) {
      setThumbHeight(0);
      return;
    }
    const minHeight = 32;
    const height = Math.max((clientHeight / scrollHeight) * clientHeight, minHeight);
    const maxTop = clientHeight - height;
    const top = (scrollTop / (scrollHeight - clientHeight)) * maxTop;
    setThumbHeight(height);
    setThumbTop(top);
  }, []);

  const triggerReveal = useCallback(() => {
    setIsVisible(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      if (!isDraggingRef.current) {
        setIsVisible(false);
      }
    }, 1200);
  }, []);

  useEffect(() => {
    updateGeometry();
    const el = navRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => updateGeometry());
    ro.observe(el);
    window.addEventListener("resize", updateGeometry);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", updateGeometry);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, [updateGeometry]);

  const handleScroll = () => {
    updateGeometry();
    triggerReveal();
  };

  const handleThumbMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    isDraggingRef.current = true;
    dragStartYRef.current = e.clientY;
    dragStartScrollTopRef.current = navRef.current?.scrollTop ?? 0;
    setIsVisible(true);

    const onMouseMove = (ev: MouseEvent) => {
      if (!isDraggingRef.current || !navRef.current) return;
      const deltaY = ev.clientY - dragStartYRef.current;
      const { clientHeight, scrollHeight } = navRef.current;
      const maxTop = clientHeight - thumbHeight;
      if (maxTop <= 0) return;
      const scrollRatio = deltaY / maxTop;
      navRef.current.scrollTop =
        dragStartScrollTopRef.current + scrollRatio * (scrollHeight - clientHeight);
    };

    const onMouseUp = () => {
      isDraggingRef.current = false;
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      triggerReveal();
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

  const handleTrackClick = (e: React.MouseEvent) => {
    if (!navRef.current || !trackRef.current) return;
    const trackRect = trackRef.current.getBoundingClientRect();
    const clickY = e.clientY - trackRect.top;
    const { clientHeight, scrollHeight } = navRef.current;
    const targetScrollRatio = clickY / clientHeight;
    navRef.current.scrollTo({
      top: targetScrollRatio * (scrollHeight - clientHeight),
      behavior: "smooth",
    });
    triggerReveal();
  };

  return (
    <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col bg-primary-deep text-white max-md:hidden">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary">
          <Leaf className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="font-bold leading-tight">AyuSphere</p>
          <p className="leading-tight opacity-60">
            Research Today · Healthier Tomorrow
          </p>
        </div>
      </div>

      <div
        className="relative flex min-h-0 flex-1 flex-col"
        onMouseEnter={triggerReveal}
        onMouseLeave={() => {
          if (!isDraggingRef.current) {
            setIsVisible(false);
          }
        }}
      >
        <nav
          ref={navRef}
          onScroll={handleScroll}
          className="scroll-dark flex flex-1 flex-col gap-0.5 overflow-y-auto px-3 pb-4"
        >
          {items.map((item) => {
            const Icon = ICONS[item.icon];
            const active =
              pathname === item.href || pathname.startsWith(`${item.href}/`);
            const count = badges?.[item.href] ?? 0;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-xl px-3 py-2.5 font-medium transition-colors duration-200",
                  active
                    ? "bg-primary text-white"
                    : "text-white/70 hover:bg-white/10 hover:text-white",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {count > 0 ? (
                  <span
                    className={cn(
                      "flex shrink-0 items-center justify-center rounded-full px-1.5 font-bold shadow-xs",
                      item.href === "/alerts"
                        ? "bg-danger text-white"
                        : active
                          ? "bg-primary-deep text-white"
                          : "bg-white/20 text-white",
                    )}
                    style={{
                      fontSize: "10px",
                      lineHeight: 1,
                      height: "16px",
                      minWidth: "16px",
                    }}
                  >
                    {count > 9 ? "9+" : count}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </nav>

        {/* Custom interactive floating animated scrollbar */}
        {thumbHeight > 0 && (
          <div
            ref={trackRef}
            onClick={handleTrackClick}
            className="pointer-events-auto absolute bottom-4 right-1 top-0 w-2"
          >
            <div
              onMouseDown={handleThumbMouseDown}
              className={cn(
                "mx-auto w-1 rounded-full bg-white/25 transition-all duration-300 ease-out hover:w-1.5 hover:bg-white/50 active:bg-white/60",
                isVisible
                  ? "pointer-events-auto scale-100 opacity-100"
                  : "pointer-events-none scale-95 opacity-0",
              )}
              style={{
                height: `${thumbHeight}px`,
                transform: `translateY(${thumbTop}px)`,
              }}
            />
          </div>
        )}
      </div>

      <div className="border-t border-white/10 px-5 py-4">
        <p className="font-bold tracking-widest">AYUSH</p>
        <p className="mt-1 leading-snug opacity-60">
          Traditional Wisdom
          <br />
          Modern Evidence
        </p>
      </div>
    </aside>
  );
}
