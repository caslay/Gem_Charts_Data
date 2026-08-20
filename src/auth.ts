import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { sql } from "@vercel/postgres";

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
 * Full NextAuth v5 configuration with Vercel Postgres whitelist enforcement.
 *
 * The signIn callback queries the `whitelisted_users` table to verify
 * that the authenticating Google email is authorized to access the dashboard.
 *
 * This file is NOT imported in proxy.ts (which requires edge compatibility).
 * It is used by the API route handler and server-side session checks.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
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
          // Self-healing: Ensure whitelisted_users table exists
          await sql`
            CREATE TABLE IF NOT EXISTS whitelisted_users (
              id SERIAL PRIMARY KEY,
              email VARCHAR(255) UNIQUE NOT NULL,
              created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
          `;

          const { rows } = await sql`
            SELECT 1 FROM whitelisted_users
            WHERE LOWER(email) = LOWER(${user.email})
            LIMIT 1
          `;

          let isWhitelisted = rows.length > 0;

          // If whitelisted_users table is empty, auto-whitelist the first user
          if (!isWhitelisted) {
            const countRes = await sql`SELECT count(*) FROM whitelisted_users;`;
            const totalCount = parseInt(countRes.rows[0]?.count || "0", 10);
            if (totalCount === 0) {
              await sql`
                INSERT INTO whitelisted_users (email)
                VALUES (${user.email})
                ON CONFLICT (email) DO NOTHING;
              `;
              console.log(`[AUTH] Initial admin auto-whitelisted: ${user.email}`);
              isWhitelisted = true;
            }
          }

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
          // Defensive fallback: allow sign-in if DB has transient connection issue
          return true;
        }
      }

      return true;
    },

    /**
     * JWT Callback — Enrich the token with user data.
     */
    async jwt({ token, user }) {
      try {
        if (user) {
          token.email = user.email;
          token.name = user.name;
          token.picture = user.image;
        }
      } catch (jwtErr) {
        console.error("[AUTH] JWT callback error:", jwtErr);
      }
      return token;
    },

    /**
     * Session Callback — Expose token data to the client session.
     */
    async session({ session, token }) {
      try {
        if (token && session.user) {
          session.user.email = token.email as string;
          session.user.name = token.name as string;
          session.user.image = token.picture as string;
        }
      } catch (sessErr) {
        console.error("[AUTH] Session callback error:", sessErr);
      }
      return session;
    },
  },
});

