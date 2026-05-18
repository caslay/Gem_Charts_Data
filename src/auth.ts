import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { sql } from "@vercel/postgres";

/**
 * Full NextAuth v5 configuration with Vercel Postgres whitelist enforcement.
 *
 * The signIn callback queries the `whitelisted_users` table to verify
 * that the authenticating Google email is authorized to access the dashboard.
 *
 * This file is NOT imported in proxy.ts (which requires edge compatibility).
 * It is used by the API route handler and server-side session checks.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
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
  callbacks: {
    /**
     * signIn Callback — Whitelist Gate
     *
     * Runs on every sign-in attempt. Queries the Vercel Postgres
     * `whitelisted_users` table. If the email is NOT found, the
     * sign-in is rejected and the user is redirected to /login?error=AccessDenied.
     */
    async signIn({ user, account }) {
      // Only enforce whitelist for Google provider
      if (account?.provider === "google") {
        if (!user.email) {
          console.error("[AUTH] Sign-in rejected: No email on Google profile.");
          return false;
        }

        try {
          const { rows } = await sql`
            SELECT 1 FROM whitelisted_users
            WHERE email = ${user.email}
            LIMIT 1
          `;

          const isWhitelisted = rows.length > 0;

          if (!isWhitelisted) {
            console.warn(
              `[AUTH] Sign-in DENIED for: ${user.email} — not in whitelist.`
            );
            return false;
          }

          console.log(`[AUTH] Sign-in APPROVED for: ${user.email}`);
          return true;
        } catch (error) {
          console.error("[AUTH] Database error during whitelist check:", error);
          // Fail-closed: deny access if DB is unreachable
          return false;
        }
      }

      return true;
    },

    /**
     * JWT Callback — Enrich the token with user data.
     */
    async jwt({ token, user }) {
      if (user) {
        token.email = user.email;
        token.name = user.name;
        token.picture = user.image;
      }
      return token;
    },

    /**
     * Session Callback — Expose token data to the client session.
     */
    async session({ session, token }) {
      if (token) {
        session.user.email = token.email as string;
        session.user.name = token.name as string;
        session.user.image = token.picture as string;
      }
      return session;
    },
  },
});
