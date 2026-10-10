"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { AppShell } from "@/components/Shell";
import { Spinner } from "@/components/ui";
import { useAuth } from "@/lib/auth";

/** Every signed-in page. Without a valid lecturer session, send the user to /login. */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { lecturer, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !lecturer) router.replace("/login");
  }, [loading, lecturer, router]);

  if (loading || !lecturer) {
    return (
      <div className="flex min-h-screen items-center justify-center text-brand-600">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }
  return <AppShell>{children}</AppShell>;
}
