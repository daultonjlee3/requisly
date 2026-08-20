import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    // Allow local UI work before .env.local is filled in.
    return supabaseResponse;
  }

  const supabase = createServerClient(
    url,
    anonKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isPublicRoute =
    path === "/" ||
    path === "/privacy" ||
    path === "/terms" ||
    path === "/llms.txt" ||
    path === "/robots.txt" ||
    path === "/sitemap.xml" ||
    path.startsWith("/login") ||
    path.startsWith("/signup") ||
    path.startsWith("/invite/") ||
    path.startsWith("/auth") ||
    path.startsWith("/s/") ||
    path.startsWith("/a/") ||
    path.startsWith("/api/");

  if (!user && !isPublicRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // Authenticated users normally skip login/signup — but NOT when the app
  // sent them to /login?error=profile. Bouncing those back to "/" creates
  // an infinite redirect loop if session context still can't load.
  const profileError =
    path === "/login" && request.nextUrl.searchParams.get("error") === "profile";

  if (user && (path === "/login" || path === "/signup") && !profileError) {
    const next = request.nextUrl.searchParams.get("next");
    const safeNext =
      next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
    return NextResponse.redirect(new URL(safeNext, request.url));
  }

  return supabaseResponse;
}
