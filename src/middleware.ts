import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { getEnv } from "@/lib/env";

const PUBLIC_PATHS = ["/login"];
const AUTH_OPTIONAL_PREFIXES = ["/api/health", "/api/slack", "/api/internal"];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/_next") || pathname.startsWith("/favicon") || pathname.includes(".")) {
    return NextResponse.next();
  }

  let env;
  try {
    env = getEnv();
  } catch {
    // Allow login page to render so README setup instructions remain reachable.
    if (pathname === "/login" || pathname === "/") {
      return NextResponse.next();
    }
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const testBypass = Boolean(env.E2E_TEST_AUTH_BYPASS) && env.NODE_ENV !== "production";

  if (testBypass) {
    if (pathname === "/login" || pathname === "/") {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }
    return NextResponse.next();
  }

  const { supabaseResponse, user } = await updateSession(request);
  const isPublic = PUBLIC_PATHS.some((path) => pathname === path);
  const isOptional = AUTH_OPTIONAL_PREFIXES.some((prefix) => pathname.startsWith(prefix));

  if (!user && !isPublic && !isOptional) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (user && (pathname === "/login" || pathname === "/")) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  if (pathname.startsWith("/admin")) {
    // Role check is enforced in the page/API; middleware only ensures auth.
  }

  return supabaseResponse;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
