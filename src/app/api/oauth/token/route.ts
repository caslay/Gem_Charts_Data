/**
 * @file src/app/api/oauth/token/route.ts
 * @description OAuth 2.0 Token Endpoint (RFC 6749 §3.2)
 *
 * Exchanges an authorization code for a long-lived Bearer access token.
 * Supports credentials passed via:
 *   1. HTTP Basic Authorization header (RFC 6749 §2.3.1)
 *   2. Request body (JSON or application/x-www-form-urlencoded)
 *
 * @version 1.0.0 — Flow-State Quant Engine V15.4
 */

import { NextResponse } from 'next/server';
import {
  validateClientCredentials,
  exchangeCodeForToken,
} from '@/lib/oauthServer';

export const dynamic = 'force-dynamic';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept',
};

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}

export async function POST(req: Request) {
  let clientId = '';
  let clientSecret = '';
  let grantType = '';
  let code = '';
  let redirectUri = '';

  // ── 1. Check HTTP Basic Auth Header ─────────────────────────────────────────
  const authHeader = req.headers.get('authorization');
  if (authHeader && authHeader.toLowerCase().startsWith('basic ')) {
    try {
      const b64 = authHeader.slice(6).trim();
      const decoded = Buffer.from(b64, 'base64').toString('utf-8');
      const colonIdx = decoded.indexOf(':');
      if (colonIdx !== -1) {
        clientId = decodeURIComponent(decoded.slice(0, colonIdx));
        clientSecret = decodeURIComponent(decoded.slice(colonIdx + 1));
      }
    } catch {
      // Fallback to body parsing if header decode fails
    }
  }

  // ── 2. Parse Request Body (form-urlencoded or JSON) ─────────────────────────
  const contentType = req.headers.get('content-type') || '';
  if (contentType.includes('application/x-www-form-urlencoded')) {
    const formDataText = await req.text();
    const params = new URLSearchParams(formDataText);
    if (!clientId) clientId = params.get('client_id') ?? '';
    if (!clientSecret) clientSecret = params.get('client_secret') ?? '';
    grantType = params.get('grant_type') ?? '';
    code = params.get('code') ?? '';
    redirectUri = params.get('redirect_uri') ?? '';
  } else {
    try {
      const json = await req.json();
      if (!clientId) clientId = json.client_id ?? '';
      if (!clientSecret) clientSecret = json.client_secret ?? '';
      grantType = json.grant_type ?? '';
      code = json.code ?? '';
      redirectUri = json.redirect_uri ?? '';
    } catch {
      // Body not JSON or empty
    }
  }

  // ── 3. Validate Grant Type ──────────────────────────────────────────────────
  if (grantType !== 'authorization_code') {
    return NextResponse.json(
      {
        error: 'unsupported_grant_type',
        error_description: 'Only "authorization_code" grant type is supported.',
      },
      { status: 400 }
    );
  }

  // ── 4. Authenticate Client ──────────────────────────────────────────────────
  if (!clientId || !clientSecret || !validateClientCredentials(clientId, clientSecret)) {
    return NextResponse.json(
      {
        error: 'invalid_client',
        error_description: 'Client authentication failed (invalid client_id or client_secret).',
      },
      { status: 401 }
    );
  }

  // ── 5. Validate Required Params ─────────────────────────────────────────────
  if (!code || !redirectUri) {
    return NextResponse.json(
      {
        error: 'invalid_request',
        error_description: 'Both "code" and "redirect_uri" are required.',
      },
      { status: 400 }
    );
  }

  // ── 6. Exchange Code for Access Token ───────────────────────────────────────
  try {
    const tokenResult = await exchangeCodeForToken(code, clientId, redirectUri);

    if (!tokenResult) {
      return NextResponse.json(
        {
          error: 'invalid_grant',
          error_description: 'Authorization code is invalid, expired, or already redeemed.',
        },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        access_token: tokenResult.access_token,
        token_type: tokenResult.token_type,
        expires_in: tokenResult.expires_in,
        scope: 'mcp',
      },
      {
        status: 200,
        headers: {
          'Cache-Control': 'no-store',
          'Pragma': 'no-cache',
        },
      }
    );
  } catch (err: any) {
    console.error('[oauth/token] Error exchanging code for token:', err);
    return NextResponse.json(
      { error: 'server_error', error_description: err.message },
      { status: 500 }
    );
  }
}
