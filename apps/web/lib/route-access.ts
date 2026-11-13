/**
 * Qué rutas se ven sin sesión (R9-4). Sin imports: lo usa el middleware, que corre en el edge.
 *
 * Regla: lo público está en una lista explícita; lo privado, en otra lista explícita de prefijos.
 * Lo que no es ni una ni otra **no existe**: el middleware lo deja pasar y Next responde su 404
 * (con o sin sesión). Una ruta privada nueva tiene que sumarse a `PRIVATE_PREFIXES`; si se olvida,
 * `route-access.test.ts` (en `packages/pipeline`) falla porque recorre `apps/web/app`.
 */

/** Rutas exactas públicas (vitrina, legales, marca). */
const PUBLIC_EXACT: readonly string[] = [
  "/",
  "/acceso",
  "/mercado",
  "/ofertas",
  "/demo",
  "/como-esta-hecho",
  "/en/how-its-built",
  "/ayuda",
  // Precios (C-12): la página misma da 404 mientras PRICING_ENABLED esté apagado
  "/precios",
  "/sitemap.xml",
  "/robots.txt",
  "/icon.svg",
  "/apple-icon.png",
  "/manifest.webmanifest",
  "/legal",
  "/privacidad",
  "/terminos",
];

/** Prefijos públicos: la ruta misma y todo lo que cuelga de ella. */
const PUBLIC_PREFIXES: readonly string[] = [
  "/login",
  "/mercado",
  "/ofertas",
  "/demo",
  "/legal",
  "/icons",
  // Recuperación de contraseña y setup inicial (JS-045): se usan sin sesión activa
  "/forgot-password",
  "/reset-password",
  "/setup",
  "/register",
];

/** Páginas generadas de metadatos de compartir: `/opengraph-image-es`, `/twitter-image`, etc. */
const PUBLIC_STARTS_WITH: readonly string[] = ["/opengraph-image", "/twitter-image"];

/**
 * Prefijos privados: existen y piden sesión (primer segmento de `app/(app)`, `app/onboarding`,
 * `app/terminos-actualizados` y `app/api`). Sin sesión redirigen al login.
 */
export const PRIVATE_PREFIXES: readonly string[] = [
  "/hoy",
  "/jobs",
  "/inbox",
  "/applications",
  "/market",
  "/plan",
  "/cv",
  "/encaje",
  "/settings",
  "/ui",
  "/onboarding",
  "/terminos-actualizados",
  // Todas las rutas de API que el matcher deja pasar por el middleware: se mantienen privadas
  "/api",
];

/**
 * Normaliza como lo haría el router: decodifica porcentajes (`/%6Aobs` es `/jobs`), junta barras
 * repetidas, saca la barra final y pasa a minúsculas (de más: nunca deja público lo privado).
 * Si no se puede decodificar, devuelve null y el llamador lo trata como privado.
 */
function normalize(pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const collapsed = decoded.replace(/\/{2,}/g, "/").toLowerCase();
  return collapsed.length > 1 ? collapsed.replace(/\/+$/, "") : collapsed;
}

function hasPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

/** ¿Es una ruta pública (se ve sin sesión)? */
export function isPublicPath(pathname: string): boolean {
  const path = normalize(pathname);
  if (path === null) return false;
  return (
    PUBLIC_EXACT.includes(path) ||
    PUBLIC_PREFIXES.some((p) => hasPrefix(path, p)) ||
    PUBLIC_STARTS_WITH.some((p) => path.startsWith(p))
  );
}

/** ¿Es una ruta privada conocida (pide sesión)? Una ruta ilegible cuenta como privada. */
export function isPrivatePath(pathname: string): boolean {
  const path = normalize(pathname);
  if (path === null) return true;
  return PRIVATE_PREFIXES.some((p) => hasPrefix(path, p));
}

/**
 * Decisión del middleware sin sesión: ¿hay que pedir login? Solo si la ruta es privada.
 * Las públicas pasan y las que no existen también (Next da el 404).
 */
export function requiresLogin(pathname: string): boolean {
  return isPrivatePath(pathname);
}
