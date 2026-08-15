/**
 * @file src/app/api/oauth/discovery/route.ts
 * @description RFC 8414 OAuth Authorization Server Metadata
 *
 * Served at /.well-known/oauth-authorization-server via next.config.ts rewrite.
 * This is the first thing Gemini Spark fetches to discover our OAuth endpoints.
 *
 * @version 1.0.0 — Flow-State Quant Engine V15.4
 */

import { NextResponse } from 'next/server';
import { getBaseUrl } from '@/lib/oauthServer';

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
  const base = getBaseUrl(req);

  // RFC 8414 — Authorization Server Metadata
  const metadata = {
    issuer: base,
    authorization_endpoint: `${base}/api/oauth/authorize`,
    token_endpoint: `${base}/api/oauth/token`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256', 'plain'],
    token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic'],
    scopes_supported: ['mcp'],
  };

  return NextResponse.json(metadata, {
    status: 200,
    headers: {
      ...CORS_HEADERS,
      'Cache-Control': 'no-store',
    },
  });
}
