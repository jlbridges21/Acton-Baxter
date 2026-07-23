import { NextResponse, type NextRequest } from "next/server";
import { isAppAccessRole, isPendingAccessRole } from "@/lib/auth/roles";
import { updateSession } from "@/lib/supabase/middleware";
import { getEnv } from "@/lib/env";

const PUBLIC_PATHS = ["/login"];
const PENDING_PATHS = ["/pending-access"];
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
    if (pathname === "/login" || pathname === "/" || pathname === "/pending-access") {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }
    return NextResponse.next();
  }

  const { supabaseResponse, user, supabase } = await updateSession(request);
  const isPublic = PUBLIC_PATHS.some((path) => pathname === path);
  const isPendingPath = PENDING_PATHS.some((path) => pathname === path);
  const isOptional = AUTH_OPTIONAL_PREFIXES.some((prefix) => pathname.startsWith(prefix));

  if (!user && !isPublic && !isOptional) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();

    const role = (profile?.role as string | undefined) ?? "new_user";

    if (isPendingAccessRole(role)) {
      if (isPublic || pathname === "/") {
        return NextResponse.redirect(new URL("/pending-access", request.url));
      }
      if (!isPendingPath && !isOptional) {
        return NextResponse.redirect(new URL("/pending-access", request.url));
      }
      return supabaseResponse;
    }

    if (isAppAccessRole(role) && (isPublic || pathname === "/" || isPendingPath)) {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }
  }

  return supabaseResponse;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
