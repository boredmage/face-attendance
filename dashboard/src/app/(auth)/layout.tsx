"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { Brand } from "@/components/Shell";
import { FaceIcon, PhoneIcon, BookIcon } from "@/components/icons";
import { useAuth } from "@/lib/auth";

/** Split layout for /login and /register: university branding on the left, form on the right. */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  const { lecturer, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && lecturer) router.replace("/");
  }, [loading, lecturer, router]);

  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-brand-700 p-10 text-white lg:flex">
        <div
          className="pointer-events-none absolute -right-32 -top-32 h-96 w-96 rounded-full border-[48px] border-white/5"
          aria-hidden
        />
        <Brand light />
        <div className="relative max-w-md">
          <p className="text-sm font-medium uppercase tracking-widest text-brand-200">University of Ibadan</p>
          <h1 className="mt-3 text-3xl font-semibold leading-tight">Attendance that takes itself.</h1>
          <p className="mt-3 text-brand-100">
            Create your courses here, let students join from the mobile app, then take attendance by scanning faces from
            your phone. Every class is logged with statistics you can export.
          </p>
          <ul className="mt-8 space-y-4 text-sm">
            <li className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/10"><BookIcon /></span>
              Create and manage your courses
            </li>
            <li className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/10"><PhoneIcon /></span>
              Start a class from the app on your phone
            </li>
            <li className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/10"><FaceIcon /></span>
              Students look at the camera and are marked present
            </li>
          </ul>
        </div>
        <p className="text-xs text-brand-200">Department of Computer Science · Face Recognition Attendance System</p>
      </aside>
      <main className="flex items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-lg">
          <div className="mb-8 lg:hidden">
            <Brand />
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
