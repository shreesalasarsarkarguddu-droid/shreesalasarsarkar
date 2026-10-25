import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

// Site switch (the power admin at /power): asked at most every 15 s per server. The database itself refuses all data
// while the site is off (is_staff / is_admin / has_perm), so this is only what people see.
let siteCache: { at: number; off: boolean } | null = null;
async function siteOff(): Promise<boolean> {
  if (siteCache && Date.now() - siteCache.at < 15_000) return siteCache.off;
  let off = false;
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/site_status`, {
      method: "POST",
      headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
      body: "{}",
      cache: "no-store",
    });
    off = !!((await r.json()) as { off?: boolean } | null)?.off;
  } catch {
    // cannot ask: show the site as usual (the database still decides what anyone can read)
  }
  siteCache = { at: Date.now(), off };
  return off;
}

const closed = (request: NextRequest) => NextResponse.rewrite(new URL("/site-off", request.url));

// Refreshes the Supabase session cookie and sends signed-out visitors to /login.
// This is only an optimistic check: the real protection is Row Level Security in the database.
export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  // the switch page works while the site is off (it checks the power admin itself)
  if (path.startsWith("/power")) return NextResponse.next({ request });
  const off = await siteOff();
  if (path.startsWith("/site-off")) return off ? NextResponse.next({ request }) : NextResponse.redirect(new URL("/accounts", request.url));
  // Leave /login alone: refreshing a stale session here would clear auth cookies on the
  // same response that the sign-in action uses to set fresh ones, so sign-in would silently fail.
  if (path.startsWith("/login")) return off ? closed(request) : NextResponse.next({ request });

  let response = NextResponse.next({ request });

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
      },
    },
  });

  const { data } = await supabase.auth.getClaims();
  if (off) {
    // only the power admin uses the site while it is off
    const { data: s } = data?.claims?.sub ? await supabase.rpc("site_status") : { data: null };
    if (!(s as { power?: boolean } | null)?.power) return closed(request);
  }
  if (!data?.claims?.sub) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  // manifest + icons must load without a login, otherwise the phone cannot install the app
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|icons/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
