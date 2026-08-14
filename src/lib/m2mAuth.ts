/**
 * @file m2mAuth.ts
 * @description Machine-to-Machine (M2M) authentication helper for the Agent Bridge API.
 *
 * This module is COMPLETELY DECOUPLED from NextAuth, browser session cookies,
 * and Google OAuth. It validates a high-entropy Bearer token against the
 * M2M_AGENT_SECRET environment variable.
 *
 * Usage:
 *   import { validateM2MToken } from '@/lib/m2mAuth';
 *   const auth = validateM2MToken(request);
 *   if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 });
 *
 * @version 1.0.0 — Flow-State Quant Engine V15.2
 */

import type { AgentAuthResult } from '@/types/agentTypes';

/** Minimum secret length for high-entropy M2M keys. */
const MIN_SECRET_LENGTH = 32;

/**
 * Emits a one-time startup warning if the M2M secret is weak or missing.
 * Only fires once per cold-start to avoid log flooding.
 */
let _secretWarningEmitted = false;
function warnSecretStrength(secret: string | undefined): void {
  if (_secretWarningEmitted) return;
  _secretWarningEmitted = true;

  if (!secret) {
    console.error(
      '[M2M Auth] ⚠️  CRITICAL: M2M_AGENT_SECRET is not set in environment variables. ' +
      'The /api/agent/context endpoint will reject all requests. ' +
      'Set this in .env.local and Vercel environment settings.'
    );
  } else if (secret.length < MIN_SECRET_LENGTH) {
    console.warn(
      `[M2M Auth] ⚠️  WARNING: M2M_AGENT_SECRET is only ${secret.length} characters. ` +
      `Minimum recommended length is ${MIN_SECRET_LENGTH} characters for high-entropy security.`
    );
  }
}

/**
 * Validates the Authorization header on an incoming M2M request.
 *
 * Expected header format:
 *   Authorization: Bearer <M2M_AGENT_SECRET>
 *
 * Returns { ok: true } on success.
 * Returns { ok: false, error: string } on any failure (caller handles HTTP response).
 *
 * IMPORTANT: Uses a timing-safe constant-time comparison to prevent
 * timing-based secret enumeration attacks.
 */
export function validateM2MToken(request: Request): AgentAuthResult {
  const secret = process.env.M2M_AGENT_SECRET;

  // Emit startup warning (once per cold start)
  warnSecretStrength(secret);

  // If no secret is configured, fail-closed immediately.
  if (!secret) {
    return {
      ok: false,
      error: 'M2M endpoint is not configured. Contact system administrator.',
    };
  }

  const authHeader = request.headers.get('Authorization');

  if (!authHeader) {
    return {
      ok: false,
      error: 'Missing Authorization header. Expected: "Authorization: Bearer <token>".',
    };
  }

  if (!authHeader.startsWith('Bearer ')) {
    return {
      ok: false,
      error: 'Invalid Authorization scheme. Expected Bearer token.',
    };
  }

  const providedToken = authHeader.slice(7).trim();

  if (!providedToken) {
    return {
      ok: false,
      error: 'Empty Bearer token provided.',
    };
  }

  // Timing-safe comparison: compare character by character without short-circuiting.
  // This prevents timing attacks that enumerate secret length or prefix.
  const isValid = timingSafeStringEqual(providedToken, secret);

  if (!isValid) {
    // Log failed attempt for audit trail (without revealing the provided token)
    console.warn(
      `[M2M Auth] 🚫 Unauthorized agent access attempt. ` +
      `Token length: ${providedToken.length}. ` +
      `Timestamp: ${new Date().toISOString()}`
    );
    return {
      ok: false,
      error: 'Invalid Bearer token. Access denied.',
    };
  }

  return { ok: true };
}

/**
 * Timing-safe string equality check.
 *
 * Iterates the full length of the expected string regardless of mismatches.
 * This prevents an attacker from measuring response time to determine
 * how many leading characters of their guess are correct.
 *
 * Note: For production-grade security, prefer Node.js `crypto.timingSafeEqual`.
 * This implementation is suitable for Next.js edge/serverless environments
 * where Buffer may not be available.
 */
function timingSafeStringEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // Still iterate to prevent trivial length-based timing oracle
    let result = 0;
    for (let i = 0; i < b.length; i++) {
      result |= (a.charCodeAt(i % a.length) ^ b.charCodeAt(i));
    }
    return false; // Always false if lengths differ
  }

  let mismatch = 0;
  for (let i = 0; i < b.length; i++) {
    mismatch |= (a.charCodeAt(i) ^ b.charCodeAt(i));
  }
  return mismatch === 0;
}
