import type { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";

/**
 * Edge-compatible auth configuration.
 * This file is imported by proxy.ts (Next.js 16's middleware replacement).
 * It MUST NOT import any Node.js-only modules (e.g., @vercel/postgres, Prisma).
 *
 * The full auth config with database callbacks lives in auth.ts.
 */
export const authConfig = {
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
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
