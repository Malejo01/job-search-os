import NextAuth from "next-auth";
import { authConfig } from "./auth.config";

/** Sin sesión redirige a /login (callback `authorized` de auth.config). Crons y webhooks quedan fuera: van con CRON_SECRET / firma. */
export default NextAuth(authConfig).auth;

export const config = {
  matcher: [
    "/((?!api/cron|api/inbound|api/health|api/auth|api/mcp|_next/static|_next/image|favicon.ico).*)",
  ],
};
