import { requiresLogin } from "./route-access";
import { THEME_SCRIPT_SOURCE } from "./theme-script-source";

/**
 * CSP con nonce en modo Report-Only. Solo en las páginas privadas, que ya se renderizan por pedido: un nonce
 * en una página pública la obligaría a dejar de ser estática. El script del tema va por hash porque se pinta
 * en el layout raíz, y leer el nonce ahí volvería dinámicas a todas las páginas. Corre en el edge.
 */
export function appliesNonceCsp(pathname: string): boolean {
  return !pathname.startsWith("/api") && requiresLogin(pathname, false);
}

export function createNonce(): string {
  return btoa(crypto.randomUUID());
}

export function reportOnlyPolicy(nonce: string, themeHash: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'sha256-${themeHash}'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-src 'self'",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

let cachedHash: Promise<string> | null = null;

/** Hash del script del tema, en base64. Se calcula una vez por instancia. */
export function themeScriptHash(): Promise<string> {
  cachedHash ??= crypto.subtle
    .digest("SHA-256", new TextEncoder().encode(THEME_SCRIPT_SOURCE))
    .then((digest) => btoa(String.fromCharCode(...new Uint8Array(digest))));
  return cachedHash;
}
