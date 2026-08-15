/**
 * proxy.ts — Next.js 16 Route Protection Layer
 *
 * In Next.js 16, middleware.ts has been DEPRECATED and renamed to proxy.ts.
 * The exported function must be named `proxy` (not `middleware`).
 *
 * This proxy protects all routes under `/` by checking for a valid
 * NextAuth session token. Unauthenticated requests are redirected
 * to the custom `/login` page.
 *
 * Uses the SPLIT CONFIG pattern: imports auth.config.ts (edge-compatible)
 * instead of auth.ts (which imports @vercel/postgres, a Node.js module).
 */
import NextAuth from "next-auth";
import { authConfig } from "@/auth.config";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const { auth } = NextAuth(authConfig);

export default auth((req) => {
  const { nextUrl } = req;
  const isLoggedIn = !!req.auth;

  // Define public routes that don't require authentication
  const isAuthRoute = nextUrl.pathname.startsWith("/api/auth");
  const isPyBackend = nextUrl.pathname.startsWith("/api/py");
  const isLoginPage = nextUrl.pathname === "/login";
  // M2M & OAuth routes — handle their own auth.
  // Must bypass the NextAuth session gate so external agents (Gemini Spark) can authenticate.
  const isM2MRoute =
    nextUrl.pathname.startsWith("/api/agent") ||
    nextUrl.pathname.startsWith("/api/mcp") ||
    nextUrl.pathname.startsWith("/api/oauth") ||
    nextUrl.pathname.startsWith("/.well-known");
  const isPublicAsset =
    nextUrl.pathname.startsWith("/_next") ||
    nextUrl.pathname.startsWith("/favicon.ico") ||
    nextUrl.pathname.startsWith("/audio") ||
    nextUrl.pathname.startsWith("/manifest.webmanifest") ||
    nextUrl.pathname.startsWith("/manifest.json") ||
    nextUrl.pathname.startsWith("/sw.js");

  // Skip proxy for auth API routes, python backend, M2M/OAuth routes, and static assets
  if (isAuthRoute || isPyBackend || isM2MRoute || isPublicAsset) {
    return NextResponse.next();
  }


  // If on the login page and already authenticated, redirect to dashboard
  if (isLoginPage) {
    if (isLoggedIn) {
      return NextResponse.redirect(new URL("/", nextUrl));
    }
    return NextResponse.next();
  }

  // For all other routes: redirect to /login if not authenticated
  if (!isLoggedIn) {
    const loginUrl = new URL("/login", nextUrl);
    loginUrl.searchParams.set("callbackUrl", nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
});

/**
 * Matcher: Run proxy on all routes EXCEPT static files, images, and favicon.
 * The NextAuth API routes are handled inside the proxy function itself.
 */
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|audio|manifest\\.webmanifest|manifest\\.json|sw\\.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp|mp3)$).*)",
  ],
};
