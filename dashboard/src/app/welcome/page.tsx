import type { Metadata } from "next";
import { connection } from "next/server";

import { Brand } from "@/components/Shell";
import { BookIcon, CheckIcon, DownloadIcon, FaceIcon, ListIcon, PhoneIcon } from "@/components/icons";
import { Badge } from "@/components/ui";

/*
 * The public landing page. On the root domain the proxy (src/proxy.ts) serves it at "/"; it sends
 * lecturers on to the dashboard and offers the phone app. The links come from the server's environment
 * when the page is requested, so changing them in .env needs a restart, not a rebuild:
 *   DASHBOARD_URL       where "Sign in" and "Create an account" go (empty: this same app)
 *   ANDROID_APK_URL     the Android build to download
 *   IOS_TESTFLIGHT_URL  the public TestFlight invitation
 */

export const metadata: Metadata = {
  title: { absolute: "UI Face Attendance · University of Ibadan" },
  description:
    "Face-recognition attendance for the University of Ibadan: lecturers run classes from the dashboard, students check in by looking at the camera.",
};

/** A link from the environment, kept only if it is a web address */
function webLink(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

// The dashboard's Button, written for links (a link to another site cannot be a <button>)
const BUTTON =
  "inline-flex h-11 items-center justify-center gap-2 rounded-lg px-5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2";
const ON_NAVY_SOLID = `${BUTTON} bg-white text-brand-700 hover:bg-brand-50 focus-visible:outline-white`;
const ON_NAVY_OUTLINE = `${BUTTON} border border-white/30 text-white hover:bg-white/10 focus-visible:outline-white`;
const PRIMARY = `${BUTTON} bg-brand-600 text-white hover:bg-brand-700 focus-visible:outline-brand-500`;
const SECONDARY = `${BUTTON} border border-slate-300 bg-white text-slate-800 hover:bg-slate-50 focus-visible:outline-brand-500`;

export default async function WelcomePage() {
  await connection();
  const dashboard = (webLink(process.env.DASHBOARD_URL) ?? "").replace(/\/$/, "");
  const apk = webLink(process.env.ANDROID_APK_URL);
  const testflight = webLink(process.env.IOS_TESTFLIGHT_URL);

  return (
    <div className="min-h-screen">
      {/* ---------- Hero ---------- */}
      <header className="relative overflow-hidden bg-brand-700 text-white">
        <div className="pointer-events-none absolute -right-40 -top-40 h-[32rem] w-[32rem] rounded-full border-[64px] border-white/5" aria-hidden />
        <div className="pointer-events-none absolute -bottom-56 -left-24 h-[28rem] w-[28rem] rounded-full border-[48px] border-white/5" aria-hidden />

        <nav className="relative mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-5 sm:px-8" aria-label="Main">
          <Brand light tagline="University of Ibadan" />
          <div className="flex items-center gap-1 sm:gap-2">
            <a href="#get-the-app" className="hidden rounded-lg px-3 py-2 text-sm font-medium text-brand-100 hover:text-white sm:inline-block">
              Get the app
            </a>
            <a href={`${dashboard}/login`} className="rounded-lg border border-white/30 px-3 py-2 text-sm font-medium text-white hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
              Sign in
            </a>
          </div>
        </nav>

        <div className="relative mx-auto grid max-w-6xl items-center gap-14 px-4 pb-20 pt-8 sm:px-8 lg:grid-cols-[minmax(0,6fr)_minmax(0,5fr)] lg:pb-28 lg:pt-14">
          <div>
            <p className="text-sm font-medium uppercase tracking-widest text-brand-200">Face Recognition Attendance</p>
            <h1 className="mt-4 text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
              Attendance that takes itself.
            </h1>
            <p className="mt-5 max-w-xl text-lg text-brand-100">
              Students look at your phone&apos;s camera and are marked present. No sheets passed around, no names
              called, no signatures to check. Every class lands on your dashboard with statistics you can export.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <a href={`${dashboard}/login`} className={ON_NAVY_SOLID}>
                Open the lecturer dashboard
              </a>
              <a href="#get-the-app" className={ON_NAVY_OUTLINE}>
                <PhoneIcon />
                Get the phone app
              </a>
            </div>
            <p className="mt-5 text-sm text-brand-200">
              New lecturer?{" "}
              <a href={`${dashboard}/register`} className="font-medium text-white underline-offset-4 hover:underline">
                Create an account
              </a>
            </p>
          </div>

          <PhoneDemo />
        </div>
      </header>

      <main>
        {/* ---------- How it works ---------- */}
        <section className="mx-auto max-w-6xl px-4 py-20 sm:px-8" aria-labelledby="how">
          <p className="text-sm font-medium uppercase tracking-widest text-brand-500">How it works</p>
          <h2 id="how" className="mt-2 max-w-2xl text-3xl font-semibold tracking-tight text-slate-900">
            From course list to attendance record in three steps
          </h2>
          <ol className="mt-10 grid gap-5 md:grid-cols-3">
            <Step n={1} icon={<BookIcon />} title="Create your courses">
              Sign in to the dashboard and add each course you teach, with its code and title.
            </Step>
            <Step n={2} icon={<FaceIcon />} title="Students join from the app">
              Students install the app, register their face once, and join your course from the list. You are
              notified on the dashboard.
            </Step>
            <Step n={3} icon={<PhoneIcon />} title="Scan the class">
              Start a session on your phone and point the camera at each student. It works without signal and syncs
              when you are back online.
            </Step>
          </ol>

          <div className="mt-5 grid gap-5 rounded-xl border border-slate-200 bg-white p-6 shadow-sm sm:grid-cols-3">
            <Fact icon={<ListIcon />} title="A record of every class">
              Who came, and which students are below 75% and may be barred from the exam.
            </Fact>
            <Fact icon={<DownloadIcon />} title="Export when you need it">
              Download a course&apos;s attendance as a spreadsheet.
            </Fact>
            <Fact icon={<CheckIcon />} title="Mark by hand too">
              Add a student yourself from the dashboard when needed.
            </Fact>
          </div>
        </section>

        {/* ---------- Get the app ---------- */}
        <section id="get-the-app" className="scroll-mt-6 border-y border-slate-200 bg-white" aria-labelledby="app">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-8">
            <p className="text-sm font-medium uppercase tracking-widest text-brand-500">The phone app</p>
            <h2 id="app" className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">Get the app</h2>
            <p className="mt-3 max-w-2xl text-slate-600">
              One app for everyone: students use it to join courses and register their face, lecturers use it to take
              attendance. Open this page on your phone to install it.
            </p>
            <div className="mt-10 grid gap-5 md:grid-cols-2">
              <AppCard
                platform="Android"
                requirement="Android 8 or later"
                href={apk}
                action="Download the APK"
                steps={[
                  "Open this page on your Android phone and tap the button to download the app.",
                  "Open the downloaded file. If Android asks, allow your browser to install apps.",
                  "Open UI Attendance and sign in, or create a student account.",
                ]}
              />
              <AppCard
                platform="iPhone"
                requirement="iOS 15.5 or later"
                href={testflight}
                action="Join on TestFlight"
                steps={[
                  "Install Apple's free TestFlight app from the App Store.",
                  "Open this page on your iPhone, tap the button, then Accept and Install.",
                  "Open UI Attendance and sign in, or create a student account.",
                ]}
              />
            </div>
          </div>
        </section>

        {/* ---------- Lecturers ---------- */}
        <section className="mx-auto max-w-6xl px-4 py-20 sm:px-8" aria-labelledby="lecturers">
          <div className="flex flex-col items-start justify-between gap-6 rounded-2xl bg-brand-50 p-8 sm:p-10 md:flex-row md:items-center">
            <div>
              <h2 id="lecturers" className="text-2xl font-semibold tracking-tight text-slate-900">Teaching this semester?</h2>
              <p className="mt-2 max-w-xl text-slate-600">
                Create a lecturer account, add your courses, and take your first attendance in the next class.
              </p>
            </div>
            <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
              <a href={`${dashboard}/register`} className={PRIMARY}>
                Create an account
              </a>
              <a href={`${dashboard}/login`} className={SECONDARY}>
                Sign in
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-200">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-8 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <p>Department of Computer Science · University of Ibadan</p>
          <p>Face Recognition Attendance System</p>
        </div>
      </footer>
    </div>
  );
}

function Step({ n, icon, title, children }: { n: number; icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <li className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-600">{icon}</span>
        <span className="text-sm font-semibold text-slate-400" aria-hidden>
          0{n}
        </span>
      </div>
      <h3 className="mt-5 font-semibold text-slate-900">{title}</h3>
      <p className="mt-2 text-sm text-slate-600">{children}</p>
    </li>
  );
}

function Fact({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 text-brand-500">{icon}</span>
      <div>
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        <p className="mt-1 text-sm text-slate-600">{children}</p>
      </div>
    </div>
  );
}

function AppCard({
  platform,
  requirement,
  href,
  action,
  steps,
}: {
  platform: string;
  requirement: string;
  href: string | null;
  action: string;
  steps: string[];
}) {
  return (
    <div className="flex flex-col rounded-xl border border-slate-200 bg-[#f4f6f9] p-6 sm:p-8">
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-600 text-white">
          <PhoneIcon />
        </span>
        <div>
          <h3 className="text-lg font-semibold text-slate-900">{platform}</h3>
          <p className="text-sm text-slate-500">{requirement}</p>
        </div>
      </div>
      <ol className="mt-6 flex-1 space-y-3">
        {steps.map((step, i) => (
          <li key={step} className="flex gap-3 text-sm text-slate-600">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white text-xs font-semibold text-brand-600 ring-1 ring-slate-200">
              {i + 1}
            </span>
            <span className="pt-0.5">{step}</span>
          </li>
        ))}
      </ol>
      {href ? (
        <a href={href} className={`${PRIMARY} mt-8 w-full`} rel="noopener">
          {platform === "Android" ? <DownloadIcon /> : <PhoneIcon />}
          {action}
        </a>
      ) : (
        <p className="mt-8 flex h-11 w-full items-center justify-center rounded-lg border border-dashed border-slate-300 text-sm text-slate-500">
          The {platform} link is coming soon
        </p>
      )}
    </div>
  );
}

/** The hero's picture: the app taking attendance, drawn with the dashboard's own pieces. Decorative. */
function PhoneDemo() {
  const roster = [
    { initials: "AO", name: "Adaeze Okafor", time: "09:02" },
    { initials: "TB", name: "Tunde Bakare", time: "09:02" },
    { initials: "FM", name: "Fatima Musa", time: "09:03" },
  ];
  return (
    <div className="relative mx-auto w-full max-w-[18.5rem]" aria-hidden>
      <div className="rounded-[2.75rem] border border-white/15 bg-brand-800 p-2.5 shadow-2xl shadow-black/40">
        <div className="overflow-hidden rounded-[2.25rem] bg-white text-slate-900">
          <div className="flex items-start justify-between gap-2 px-5 pt-6">
            <div>
              <p className="text-sm font-semibold">CSC 401</p>
              <p className="text-xs text-slate-500">Software Engineering</p>
            </div>
            <Badge tone="live">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
              Live
            </Badge>
          </div>

          <div className="relative mx-4 mt-4 aspect-[4/3] overflow-hidden rounded-2xl bg-brand-800">
            {/* a face, its frame, and the scan passing over it */}
            <svg viewBox="0 0 120 90" className="absolute inset-0 h-full w-full text-brand-200" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.4">
              <ellipse cx="60" cy="42" rx="17" ry="21" />
              <path d="M53 38v2M67 38v2M55 51a7 7 0 0 0 10 0" />
              <path d="M34 90c3-12 13-19 26-19s23 7 26 19" />
              <g stroke="white" strokeWidth="2">
                <path d="M36 18v-6h8M84 18v-6h-8M36 66v6h8M84 66v6h-8" />
              </g>
            </svg>
            <div className="animate-scan absolute inset-x-8 h-px bg-white shadow-[0_0_12px_2px_rgba(255,255,255,0.6)]" />
            <p className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-brand-800/90 px-2.5 py-0.5 text-xs text-brand-100">
              Hold still…
            </p>
          </div>

          <ul className="space-y-2.5 px-4 pb-4 pt-4">
            {roster.map((s, i) => (
              <li key={s.name} className="animate-rise flex items-center gap-3" style={{ animationDelay: `${300 + i * 450}ms` }}>
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-semibold text-brand-600">
                  {s.initials}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{s.name}</p>
                  <p className="text-xs text-slate-500">{s.time}</p>
                </div>
                <Badge tone="good">Present</Badge>
              </li>
            ))}
            <li className="animate-rise flex items-center gap-3" style={{ animationDelay: "1650ms" }}>
              <span className="h-8 w-8 shrink-0 animate-pulse rounded-full bg-slate-100" />
              <div className="flex-1 space-y-1.5">
                <span className="block h-2.5 w-24 animate-pulse rounded bg-slate-100" />
                <span className="block h-2 w-10 animate-pulse rounded bg-slate-100" />
              </div>
              <Badge tone="brand">Scanning</Badge>
            </li>
          </ul>
          <div className="border-t border-slate-100 px-5 py-3 text-right text-xs text-slate-500">3 of 42 present</div>
        </div>
      </div>

      {/* what the lecturer sees meanwhile */}
      <div className="animate-rise absolute -bottom-5 -left-16 hidden items-center gap-3 rounded-xl bg-white p-3 pr-4 text-slate-900 shadow-xl shadow-black/20 sm:flex" style={{ animationDelay: "900ms" }}>
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-green-50 text-green-800">
          <CheckIcon width={16} height={16} />
        </span>
        <div className="leading-tight">
          <p className="text-sm font-medium">Marked present</p>
          <p className="text-xs text-slate-500">Tunde Bakare · 09:02</p>
        </div>
      </div>
      <div className="animate-rise absolute -right-12 -top-4 hidden items-center gap-2 rounded-full bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-xl shadow-black/20 sm:flex" style={{ animationDelay: "2100ms" }}>
        <span className="h-2 w-2 rounded-full bg-status-good" />
        Synced to the dashboard
      </div>
    </div>
  );
}
