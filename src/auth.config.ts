import type { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";

const googleClientId =
  process.env.AUTH_GOOGLE_ID ||
  process.env.GOOGLE_CLIENT_ID ||
  process.env.GOOGLE_ID ||
  "";

const googleClientSecret =
  process.env.AUTH_GOOGLE_SECRET ||
  process.env.GOOGLE_CLIENT_SECRET ||
  process.env.GOOGLE_SECRET ||
  "";

const authSecret =
  process.env.AUTH_SECRET ||
  process.env.NEXTAUTH_SECRET ||
  "";

/**
 * Edge-compatible auth configuration.
 * This file is imported by proxy.ts (Next.js 16's middleware replacement).
 * It MUST NOT import any Node.js-only modules (e.g., @vercel/postgres, Prisma).
 *
 * The full auth config with database callbacks lives in auth.ts.
 */
export const authConfig = {
  trustHost: true,
  secret: authSecret,
  providers: [
    Google({
      clientId: googleClientId,
      clientSecret: googleClientSecret,
    }),
  ],
  pages: {
    signIn: "/login",
    error: "/login",
  },
  session: {
    strategy: "jwt",
  },
} satisfies NextAuthConfig;

