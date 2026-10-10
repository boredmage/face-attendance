"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { api, type NotificationList } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { timeAgo } from "@/lib/format";

import { BellIcon, BookIcon, CloseIcon, HomeIcon, ListIcon, LogoutIcon, MenuIcon, UserIcon } from "./icons";
import { useToast } from "./Toast";
import { cx } from "./ui";

const NAV = [
  { href: "/", label: "Overview", icon: HomeIcon },
  { href: "/courses", label: "Courses", icon: BookIcon },
  { href: "/sessions", label: "Class logs", icon: ListIcon },
  { href: "/notifications", label: "Notifications", icon: BellIcon },
  { href: "/profile", label: "Profile", icon: UserIcon },
];

const POLL_MS = 20_000;

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

export function Brand({ light }: { light?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div className={cx("flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold", light ? "bg-white text-brand-600" : "bg-brand-600 text-white")}>
        UI
      </div>
      <div className="leading-tight">
        <p className={cx("text-sm font-semibold", light ? "text-white" : "text-slate-900")}>Face Attendance</p>
        <p className={cx("text-xs", light ? "text-brand-100" : "text-slate-500")}>Lecturer dashboard</p>
      </div>
    </div>
  );
}

function SidebarNav({ unread, onNavigate }: { unread: number; onNavigate?: () => void }) {
  const pathname = usePathname();
  const { lecturer, logout } = useAuth();
  return (
    <div className="flex h-full flex-col bg-brand-700 text-white">
      <div className="px-5 py-5">
        <Brand light />
      </div>
      <nav className="flex-1 space-y-1 px-3" aria-label="Main">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = isActive(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cx(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                active ? "bg-white/15 text-white" : "text-brand-100 hover:bg-white/10 hover:text-white",
              )}
            >
              <Icon />
              <span className="flex-1">{label}</span>
              {href === "/notifications" && unread > 0 ? (
                <span className="rounded-full bg-red-500 px-1.5 text-xs font-semibold text-white">{unread}</span>
              ) : null}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-white/10 p-4">
        <p className="truncate text-sm font-medium">{lecturer?.display_name}</p>
        <p className="truncate text-xs text-brand-100">{lecturer?.department}</p>
        <button onClick={logout} className="mt-3 flex items-center gap-2 text-sm text-brand-100 hover:text-white">
          <LogoutIcon width={16} height={16} /> Log out
        </button>
      </div>
    </div>
  );
}

function NotificationBell({ data, onChange }: { data: NotificationList | null; onChange: (d: NotificationList) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const unread = data?.unread ?? 0;
  const items = data?.items.slice(0, 5) ?? [];

  const markAll = async () => {
    const res = await api.readAll().catch(() => null);
    if (res) onChange({ unread: res.unread, items: res.items.slice(0, 5) });
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative rounded-lg p-2 text-slate-600 hover:bg-slate-100"
        aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}
        aria-expanded={open}
      >
        <BellIcon />
        {unread > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[11px] font-semibold text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        ) : null}
      </button>
      {open ? (
        <div className="absolute right-0 z-30 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <p className="text-sm font-semibold text-slate-900">Notifications</p>
            {unread > 0 ? (
              <button onClick={markAll} className="text-xs font-medium text-brand-600 hover:underline">
                Mark all read
              </button>
            ) : null}
          </div>
          {items.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-slate-500">No notifications yet.</p>
          ) : (
            <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto">
              {items.map((n) => (
                <li key={n.id}>
                  <Link
                    href={n.course_id ? `/courses/${n.course_id}` : "/notifications"}
                    onClick={() => {
                      setOpen(false);
                      if (!n.read) void api.readOne(n.id).catch(() => undefined);
                    }}
                    className={cx("flex gap-3 px-4 py-3 text-sm hover:bg-slate-50", !n.read && "bg-brand-50/60")}
                  >
                    <span className={cx("mt-1.5 h-2 w-2 shrink-0 rounded-full", n.read ? "bg-transparent" : "bg-brand-500")} aria-hidden />
                    <span className="min-w-0">
                      <span className="block text-slate-800">{n.message}</span>
                      <span className="text-xs text-slate-500">{timeAgo(n.created_at)}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <Link href="/notifications" onClick={() => setOpen(false)} className="block border-t border-slate-100 px-4 py-2.5 text-center text-sm font-medium text-brand-600 hover:bg-slate-50">
            View all
          </Link>
        </div>
      ) : null}
    </div>
  );
}

/** Polls the notification feed and toasts when new ones arrive. */
function useNotifications() {
  const { toast } = useToast();
  const [data, setData] = useState<NotificationList | null>(null);
  const lastUnread = useRef<number | null>(null);
  const lastTopId = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await api.notifications(5);
        if (cancelled) return;
        const newest = res.items.find((n) => !n.read);
        if (lastUnread.current !== null && res.unread > lastUnread.current && newest && newest.id !== lastTopId.current) {
          const extra = res.unread - lastUnread.current - 1;
          toast(
            newest.course_code && newest.student_name
              ? `New student joined ${newest.course_code}: ${newest.student_name}${extra > 0 ? ` (+${extra} more)` : ""}`
              : newest.message,
          );
        }
        lastUnread.current = res.unread;
        lastTopId.current = res.items[0]?.id ?? null;
        setData(res);
      } catch {
        // transient; next poll retries
      }
    };
    void load();
    const id = window.setInterval(load, POLL_MS);
    // Pages that change notifications (mark as read) announce it so the badge updates at once
    const refresh = () => void load();
    window.addEventListener("notifications:changed", refresh);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      window.removeEventListener("notifications:changed", refresh);
    };
  }, [toast]);

  const update = (d: NotificationList) => {
    lastUnread.current = d.unread;
    setData(d);
    window.dispatchEvent(new Event("notifications:changed"));
  };
  return { data, update };
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [drawer, setDrawer] = useState(false);
  const { lecturer } = useAuth();
  const { data, update } = useNotifications();
  const pathname = usePathname();
  const current = NAV.find((n) => isActive(pathname, n.href));

  return (
    <div className="min-h-screen lg:pl-64">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 hidden w-64 lg:block">
        <SidebarNav unread={data?.unread ?? 0} />
      </aside>

      {/* Mobile drawer */}
      {drawer ? (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setDrawer(false)} />
          <div className="absolute inset-y-0 left-0 w-72 max-w-[85vw] shadow-xl">
            <button onClick={() => setDrawer(false)} className="absolute right-3 top-5 z-10 rounded-md p-1 text-white/80 hover:bg-white/10" aria-label="Close menu">
              <CloseIcon />
            </button>
            <SidebarNav unread={data?.unread ?? 0} onNavigate={() => setDrawer(false)} />
          </div>
        </div>
      ) : null}

      <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur sm:px-6">
        <button onClick={() => setDrawer(true)} className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden" aria-label="Open menu">
          <MenuIcon />
        </button>
        <p className="text-sm font-medium text-slate-500 lg:hidden">{current?.label}</p>
        <div className="ml-auto flex items-center gap-3">
          <NotificationBell data={data} onChange={update} />
          <Link href="/profile" className="flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-slate-100">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-50 text-xs font-semibold text-brand-600">
              {initials(lecturer?.name ?? "")}
            </span>
            <span className="hidden text-sm font-medium text-slate-800 sm:block">{lecturer?.display_name}</span>
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">{children}</main>
    </div>
  );
}

function initials(name: string) {
  const parts = name.replace(/\./g, " ").split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[parts.length - 1]?.[0] ?? "")).toUpperCase();
}
