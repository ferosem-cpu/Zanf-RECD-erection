"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import { api } from "@/lib/apiClient";

interface NotificationItem {
  id: string;
  templateKey: string;
  payload: Record<string, any>;
  createdAt: string;
  readAt: string | null;
}

// Renders a short, human title (and an optional link) per templateKey. Falls back to a
// de-slugged version of the key itself so a future notification type never renders blank.
function describeNotification(n: NotificationItem): { title: string; href?: string } {
  const p = n.payload || {};
  if (n.templateKey === "new_order_placed") {
    const qty = p.quantity ? ` x${p.quantity}` : "";
    return {
      title: `New order request ${p.orderNumber ?? ""} from ${p.customer ?? "a customer"}${p.product ? ` — ${p.product}${qty}` : ""}`,
      href: p.orderId ? `/orders/${p.orderId}` : undefined,
    };
  }
  return { title: String(n.templateKey).replace(/_/g, " ") };
}
function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

interface NotificationBellProps {
  /** Extra classes for the bell button - lets callers on a dark background (e.g. the sidebar)
   * override the default light-chrome hover/color styling. The dropdown panel itself always
   * uses fixed light colors regardless, since it renders on its own white surface either way. */
  buttonClassName?: string;
}

export default function NotificationBell({ buttonClassName }: NotificationBellProps) {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const data = await api<{ items: NotificationItem[]; unreadCount: number }>("/notifications");
      setItems(data.items);
      setUnreadCount(data.unreadCount);
    } catch (err) {
      console.error("Failed to load notifications", err);
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, [load]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  async function markRead(id: string) {
    setItems((prev) => prev.map((n) => (n.id === id && !n.readAt ? { ...n, readAt: new Date().toISOString() } : n)));
    setUnreadCount((prev) => Math.max(0, prev - 1));
    try {
      await api(`/notifications/${id}/read`, { method: "POST" });
    } catch (err) {
      console.error("Failed to mark notification read", err);
    }
  }

  async function markAllRead() {
    setItems((prev) => prev.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })));
    setUnreadCount(0);
    try {
      await api("/notifications/read-all", { method: "POST" });
    } catch (err) {
      console.error("Failed to mark all notifications read", err);
    }
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        data-testid="notification-bell-button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Notifications"
        className={`relative p-2 rounded-lg transition-colors ${buttonClassName ?? "text-gray-500 hover:bg-black/5"}`}
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 max-w-[90vw] rounded-xl border border-gray-200 bg-white shadow-xl z-50">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <p className="text-sm font-semibold text-gray-900">Notifications</p>
            {unreadCount > 0 && (
              <button onClick={markAllRead} className="text-xs font-medium text-[var(--theme-accent)] hover:underline">
                Mark all read
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {items.length === 0 && (
              <p className="px-4 py-6 text-center text-xs text-gray-400">No notifications yet.</p>
            )}
            {items.map((n) => {
              const { title, href } = describeNotification(n);
              const rowClasses = `block px-4 py-3 border-b border-gray-50 last:border-0 hover:bg-gray-50 cursor-pointer ${!n.readAt ? "bg-emerald-50/40" : ""}`;
              const rowContent = (
                <>
                  <p className="text-xs text-gray-800 leading-snug">{title}</p>
                  <p className="text-[10px] text-gray-400 mt-1">{timeAgo(n.createdAt)}</p>
                </>
              );
              return href ? (
                <Link key={n.id} href={href} className={rowClasses} onClick={() => !n.readAt && markRead(n.id)}>
                  {rowContent}
                </Link>
              ) : (
                <div key={n.id} className={rowClasses} onClick={() => !n.readAt && markRead(n.id)}>
                  {rowContent}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
