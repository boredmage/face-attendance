"use client";

import Link from "next/link";
import { useState } from "react";

import { BellIcon } from "@/components/icons";
import { useToast } from "@/components/Toast";
import { Button, Card, EmptyState, ErrorState, PageHeader, Skeleton, cx } from "@/components/ui";
import { api, errorText, type NotificationList } from "@/lib/api";
import { formatDateTime, timeAgo } from "@/lib/format";
import { useApi } from "@/lib/hooks";

function announce() {
  // Tells the top-bar bell to refresh its unread badge
  window.dispatchEvent(new Event("notifications:changed"));
}

export default function NotificationsPage() {
  const { toast } = useToast();
  const { data, error, loading, reload } = useApi(() => api.notifications(200), "notifications", 20_000);
  const [local, setLocal] = useState<NotificationList | null>(null);
  const [busy, setBusy] = useState(false);
  const list = local ?? data;

  const markAll = async () => {
    setBusy(true);
    try {
      await api.readAll();
      setLocal(null);
      await reload();
      announce();
    } catch (err) {
      toast(errorText(err), "error");
    } finally {
      setBusy(false);
    }
  };

  const markOne = async (id: number) => {
    if (!list) return;
    setLocal({
      unread: Math.max(0, list.unread - 1),
      items: list.items.map((n) => (n.id === id ? { ...n, read: true } : n)),
    });
    try {
      await api.readOne(id);
      announce();
    } catch {
      setLocal(null);
    }
  };

  return (
    <>
      <PageHeader
        title="Notifications"
        subtitle={list ? (list.unread ? `${list.unread} unread` : "You're all caught up") : undefined}
        actions={
          list && list.unread > 0 ? (
            <Button variant="secondary" onClick={markAll} loading={busy}>
              Mark all as read
            </Button>
          ) : null
        }
      />
      <Card>
        {loading ? (
          <div className="space-y-2 p-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-14" />
            ))}
          </div>
        ) : !list ? (
          <div className="p-4">
            <ErrorState message={error ?? "Could not load notifications."} onRetry={reload} />
          </div>
        ) : list.items.length === 0 ? (
          <EmptyState
            icon={<BellIcon width={28} height={28} />}
            title="No notifications yet"
            message="You'll be notified here when a student joins one of your courses."
          />
        ) : (
          <ul className="divide-y divide-slate-100">
            {list.items.map((n) => (
              <li key={n.id} className={cx("flex flex-wrap items-start gap-3 px-5 py-4 sm:flex-nowrap", !n.read && "bg-brand-50/50")}>
                <span className={cx("mt-2 h-2 w-2 shrink-0 rounded-full", n.read ? "bg-slate-200" : "bg-brand-500")} aria-label={n.read ? "Read" : "Unread"} />
                <div className="min-w-0 flex-1">
                  <p className={cx("text-sm", n.read ? "text-slate-700" : "font-medium text-slate-900")}>{n.message}</p>
                  <p className="mt-0.5 text-xs text-slate-500" title={formatDateTime(n.created_at)}>
                    {timeAgo(n.created_at)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {n.course_id ? (
                    <Link
                      href={`/courses/${n.course_id}`}
                      onClick={() => !n.read && void markOne(n.id)}
                      className="rounded-lg px-2.5 py-1 text-sm font-medium text-brand-600 hover:bg-brand-50"
                    >
                      View {n.course_code ?? "course"}
                    </Link>
                  ) : null}
                  {!n.read ? (
                    <Button size="sm" variant="ghost" onClick={() => markOne(n.id)}>
                      Mark read
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
