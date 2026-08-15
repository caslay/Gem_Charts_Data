/**
 * @file src/app/api/oauth/authorize/route.ts
 * @description OAuth 2.0 Authorization Endpoint (RFC 6749 §3.1)
 *
 * Gemini Spark redirects the user here to start the authorization flow.
 * Since this is a single trusted client (Gemini), we auto-approve and
 * immediately redirect back with an auth code — no user-facing consent UI needed.
 *
 * GET /api/oauth/authorize
 *   ?response_type=code
 *   &client_id=<OAUTH_CLIENT_ID>
 *   &redirect_uri=<gemini_callback>
 *   &state=<csrf_state>
 *   &code_challenge=<pkce_challenge>        (optional)
 *   &code_challenge_method=S256             (optional)
 *
 * @version 1.0.0 — Flow-State Quant Engine V15.4
 */

import { NextResponse } from 'next/server';
import {
  getOAuthClientCredentials,
  issueAuthCode,
} from '@/lib/oauthServer';

export const dynamic = 'force-dynamic';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept',
};

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  const responseType = searchParams.get('response_type');
  const clientId     = searchParams.get('client_id') ?? '';
  const redirectUri  = searchParams.get('redirect_uri') ?? '';
  const state        = searchParams.get('state') ?? '';

  // ── Validate response_type ────────────────────────────────────────────────
  if (responseType !== 'code') {
    return NextResponse.json(
      { error: 'unsupported_response_type', error_description: 'Only "code" is supported.' },
      { status: 400 }
    );
  }

  // ── Validate client_id ────────────────────────────────────────────────────
  const creds = getOAuthClientCredentials();
  if (!creds) {
    return NextResponse.json(
      { error: 'server_error', error_description: 'OAuth server not configured. Set OAUTH_CLIENT_ID and OAUTH_CLIENT_SECRET.' },
      { status: 500 }
    );
  }
  if (clientId !== creds.clientId) {
    return NextResponse.json(
      { error: 'invalid_client', error_description: 'Unknown client_id.' },
      { status: 401 }
    );
  }

  // ── Validate redirect_uri ─────────────────────────────────────────────────
  if (!redirectUri) {
    return NextResponse.json(
      { error: 'invalid_request', error_description: 'redirect_uri is required.' },
      { status: 400 }
    );
  }

  // ── Issue auth code and redirect ──────────────────────────────────────────
  try {
    const code = await issueAuthCode(clientId, redirectUri);

    const callbackUrl = new URL(redirectUri);
    callbackUrl.searchParams.set('code', code);
    if (state) callbackUrl.searchParams.set('state', state);

    console.log(`[oauth/authorize] ✅ Auth code issued for ${clientId} → ${redirectUri}`);

    return NextResponse.redirect(callbackUrl.toString(), { status: 302 });
  } catch (err: any) {
    console.error('[oauth/authorize] Error issuing auth code:', err);
    return NextResponse.json(
      { error: 'server_error', error_description: err.message },
      { status: 500 }
    );
  }
}
