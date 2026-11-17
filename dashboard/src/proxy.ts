import { NextResponse, type NextRequest } from "next/server";

/**
 * One app, two hostnames. The root domain (SITE_URL) shows the public landing page (/welcome) at "/";
 * every other page there belongs to the dashboard and is sent to DASHBOARD_URL, where signing in works
 * (the API only accepts the dashboard's origin). Without SITE_URL (local development) nothing changes.
 * Both are read when the server runs, so changing them needs a restart, not a rebuild.
 */
function hostOf(url: string | undefined): string | null {
  try {
    return url ? new URL(url).host.toLowerCase() : null;
  } catch {
    return null;
  }
}

export function proxy(request: NextRequest) {
  const site = hostOf(process.env.SITE_URL);
  if (!site || request.headers.get("host")?.toLowerCase() !== site) return NextResponse.next();

  const { pathname, search } = request.nextUrl;
  if (pathname === "/") return NextResponse.rewrite(new URL("/welcome", request.url));
  // (request.url carries the server's own address behind Caddy: redirects are built from the settings)
  if (pathname === "/welcome") return NextResponse.redirect(new URL("/", process.env.SITE_URL));

  const dashboard = process.env.DASHBOARD_URL;
  return dashboard ? NextResponse.redirect(new URL(pathname + search, dashboard)) : NextResponse.next();
}

export const config = {
  // Scripts, styles and images load on both hosts
  matcher: ["/((?!_next/|favicon.ico).*)"],
};
