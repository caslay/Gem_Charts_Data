"use client";

import { SessionProvider } from "next-auth/react";

/**
 * Auth Session Provider wrapper.
 *
 * Wraps the application in NextAuth's SessionProvider so that
 * useSession(), signIn(), and signOut() are available in all
 * client components without prop drilling.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}
