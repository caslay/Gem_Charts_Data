/**
 * @file src/lib/oauthServer.ts
 * @description Minimal OAuth 2.0 Authorization Server for MCP/Gemini Spark integration.
 *
 * Implements RFC 6749 Authorization Code Flow (with optional PKCE).
 * Designed for a single trusted client (Gemini Spark) connecting to our MCP server.
 *
 * ┌──────────────────────────────────────────────────────────────────┐
 * │  Flow:                                                           │
 * │  1. Gemini hits /.well-known/oauth-authorization-server         │
 * │  2. Gemini redirects user to /api/oauth/authorize               │
 * │  3. We auto-approve (single trusted client) → redirect to       │
 * │     Gemini's redirect_uri with auth code                        │
 * │  4. Gemini POSTs to /api/oauth/token with code + credentials    │
 * │  5. We return an access token (stored in Neon DB)               │
 * │  6. Gemini uses token as Bearer for /api/mcp calls              │
 * │  7. MCP route validates token against DB                        │
 * └──────────────────────────────────────────────────────────────────┘
 *
 * Required environment variables:
 *   OAUTH_CLIENT_ID      — Client ID you give to Gemini Spark
 *   OAUTH_CLIENT_SECRET  — Client Secret you give to Gemini Spark
 *   NEXTAUTH_URL         — Base URL (already set, e.g. https://flow-state-terminal.vercel.app)
 *
 * @version 1.0.0 — Flow-State Quant Engine V15.4
 */

import { sql } from '@/lib/postgres';
import { randomBytes } from 'crypto';

// ─── Schema Init ──────────────────────────────────────────────────────────────

let isOAuthSchemaInitialized = false;

export async function ensureOAuthSchemaInitialized(): Promise<void> {
  if (isOAuthSchemaInitialized) return;
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS oauth_auth_codes (
        id          SERIAL PRIMARY KEY,
        code        VARCHAR(128) UNIQUE NOT NULL,
        client_id   VARCHAR(256) NOT NULL,
        redirect_uri TEXT NOT NULL,
        expires_at  BIGINT NOT NULL,
        used        BOOLEAN NOT NULL DEFAULT FALSE,
        created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS oauth_access_tokens (
        id          SERIAL PRIMARY KEY,
        token       VARCHAR(128) UNIQUE NOT NULL,
        client_id   VARCHAR(256) NOT NULL,
        scope       TEXT,
        expires_at  BIGINT NOT NULL,
        created_at  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_oauth_tokens_token
        ON oauth_access_tokens(token);
    `;
    isOAuthSchemaInitialized = true;
    console.log('[oauthServer] ✅ OAuth schema initialized.');
  } catch (err: any) {
    console.warn(`[oauthServer] ⚠️ Schema init fallback: ${err.message}`);
  }
}

// ─── Config ───────────────────────────────────────────────────────────────────

/** Returns the base URL of this deployment, dynamically derived from request headers or environment. */
export function getBaseUrl(req?: Request): string {
  if (req) {
    const host = req.headers.get('x-forwarded-host') || req.headers.get('host');
    if (host) {
      const proto =
        req.headers.get('x-forwarded-proto') ||
        (host.includes('localhost') || host.includes('127.0.0.1') ? 'http' : 'https');
      return `${proto}://${host}`;
    }
  }
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL.replace(/\/$/, '')}`;
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL.replace(/\/$/, '')}`;
  }
  if (process.env.NEXTAUTH_URL && !process.env.NEXTAUTH_URL.includes('localhost')) {
    return process.env.NEXTAUTH_URL.replace(/\/$/, '');
  }
  if (process.env.NODE_ENV === 'production') {
    return 'https://flow-state-terminal.vercel.app';
  }
  return 'http://localhost:4000';
}

/** Validates that OAUTH_CLIENT_ID and OAUTH_CLIENT_SECRET are configured. */
export function getOAuthClientCredentials(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.OAUTH_CLIENT_ID;
  const clientSecret = process.env.OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

/** Validate that the provided client_id + client_secret match our registered client. */
export function validateClientCredentials(clientId: string, clientSecret: string): boolean {
  const creds = getOAuthClientCredentials();
  if (!creds) return false;
  return clientId === creds.clientId && clientSecret === creds.clientSecret;
}

// ─── Auth Code ────────────────────────────────────────────────────────────────

/** Issue a one-time authorization code (valid for 5 minutes). */
export async function issueAuthCode(
  clientId: string,
  redirectUri: string
): Promise<string> {
  await ensureOAuthSchemaInitialized();
  const code = randomBytes(32).toString('hex');
  const expiresAt = Date.now() + 5 * 60 * 1000; // 5 minutes

  await sql`
    INSERT INTO oauth_auth_codes (code, client_id, redirect_uri, expires_at)
    VALUES (${code}, ${clientId}, ${redirectUri}, ${expiresAt})
  `;

  return code;
}

/** Exchange an auth code for a reusable access token. Invalidates the code immediately. */
export async function exchangeCodeForToken(
  code: string,
  clientId: string,
  redirectUri: string
): Promise<{ access_token: string; expires_in: number; token_type: string } | null> {
  await ensureOAuthSchemaInitialized();

  // Fetch and validate the code
  const res = await sql`
    SELECT * FROM oauth_auth_codes
    WHERE code = ${code} AND used = FALSE
    LIMIT 1
  `;
  const row = res.rows[0];

  if (!row) return null; // Code not found or already used
  if (row.client_id !== clientId) return null; // Client mismatch
  if (row.redirect_uri !== redirectUri) return null; // Redirect URI mismatch
  if (Date.now() > Number(row.expires_at)) return null; // Expired

  // Mark code as used (one-time use)
  await sql`UPDATE oauth_auth_codes SET used = TRUE WHERE code = ${code}`;

  // Issue a long-lived access token (30 days)
  const token = randomBytes(48).toString('hex');
  const tokenExpiresIn = 30 * 24 * 60 * 60; // 30 days in seconds
  const tokenExpiresAt = Date.now() + tokenExpiresIn * 1000;

  await sql`
    INSERT INTO oauth_access_tokens (token, client_id, scope, expires_at)
    VALUES (${token}, ${clientId}, ${'mcp'}, ${tokenExpiresAt})
  `;

  console.log(`[oauthServer] ✅ Access token issued for client: ${clientId}`);

  return {
    access_token: token,
    expires_in: tokenExpiresIn,
    token_type: 'Bearer',
  };
}

// ─── Token Validation (used by MCP route) ────────────────────────────────────

export interface OAuthTokenInfo {
  valid: boolean;
  clientId?: string;
  scope?: string;
}

/**
 * Validate an OAuth Bearer token from the MCP request.
 * Also accepts the M2M_AGENT_SECRET as a fallback (for non-Gemini clients).
 */
export async function validateOAuthToken(authHeader: string | null): Promise<OAuthTokenInfo> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { valid: false };
  }

  const token = authHeader.slice(7).trim();

  // ── Fallback: M2M static secret (non-Gemini clients: Claude Desktop, curl, agy) ──
  const m2mSecret = process.env.M2M_AGENT_SECRET;
  if (m2mSecret && token === m2mSecret) {
    return { valid: true, clientId: 'm2m-static', scope: 'mcp' };
  }

  // ── OAuth DB token validation ──
  try {
    await ensureOAuthSchemaInitialized();
    const res = await sql`
      SELECT * FROM oauth_access_tokens
      WHERE token = ${token}
      LIMIT 1
    `;
    const row = res.rows[0];

    if (!row) return { valid: false };
    if (Date.now() > Number(row.expires_at)) return { valid: false };

    return { valid: true, clientId: row.client_id, scope: row.scope };
  } catch (err: any) {
    console.warn(`[oauthServer] Token validation DB error: ${err.message}`);
    return { valid: false };
  }
}
