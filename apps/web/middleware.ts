import NextAuth from "next-auth";
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import { authConfig } from "./auth.config";
import { appliesNonceCsp, createNonce, reportOnlyPolicy, themeScriptHash } from "./lib/csp";

const authMiddleware = NextAuth(authConfig).auth as unknown as (
  request: NextRequest,
  event: NextFetchEvent,
) => Promise<Response | undefined>;

/**
 * Sin sesión redirige a /login (callback `authorized` de auth.config). Crons y webhooks quedan fuera: van con
 * CRON_SECRET / firma. Auth.js decide primero: envuelto como handler dejaría de redirigir, por eso la CSP se
 * suma después y solo a los pedidos que siguen de largo.
 */
export default async function middleware(
  request: NextRequest,
  event: NextFetchEvent,
): Promise<Response | undefined> {
  const response = await authMiddleware(request, event);
  if (!response?.headers.has("x-middleware-next")) return response;
  if (!appliesNonceCsp(request.nextUrl.pathname)) return response;

  const nonce = createNonce();
  const policy = reportOnlyPolicy(nonce, await themeScriptHash());
  // Next toma el nonce de este header del pedido y lo pone en sus propios scripts
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("content-security-policy-report-only", policy);
  const next = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.forEach((value, key) => {
    if (!key.startsWith("x-middleware-") && key !== "set-cookie") next.headers.set(key, value);
  });
  for (const cookie of response.headers.getSetCookie()) next.headers.append("set-cookie", cookie);
  next.headers.set("Content-Security-Policy-Report-Only", policy);
  return next;
}

export const config = {
  matcher: [
    "/((?!api/cron|api/inbound|api/health|api/auth|api/mcp|_next/static|_next/image|favicon.ico).*)",
  ],
};
