/**
 * NextAuth v5 API Route Handler
 *
 * Exposes GET and POST handlers for the /api/auth/* routes.
 * These handle the OAuth flow (sign-in, sign-out, callbacks, session).
 */
import { handlers } from "@/auth";

export const { GET, POST } = handlers;
