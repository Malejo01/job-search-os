/**
 * La pantalla de un comentario (R26-04), pura y sin I/O. Una ruta con ids o slugs
 * (`/jobs/3f2b…`, `/academy/como-es-una-entrevista`) se vuelve la ruta del árbol de `app/`
 * (`/jobs/[id]`, `/academy/[slug]`), así los comentarios se agrupan por pantalla y la ruta nunca
 * lleva ids de ofertas ni de otras cosas de la persona.
 */

/**
 * Las rutas del árbol de `apps/web/app` que llevan un segmento dinámico, más las pantallas fijas
 * que son hermanas de una dinámica (`/jobs/new` cuelga de `/jobs/[id]`: sin estar en la lista se
 * tomaría por un id). Un test de `apps/web` compara esta lista con el árbol real.
 */
export const SCREEN_ROUTE_PATTERNS: readonly string[] = [
  "/academy/[slug]",
  "/admin/personas/[id]",
  "/demo/[perfil]",
  "/demo/contaduria",
  "/inbox/[id]",
  "/interview/[id]",
  "/jobs/[id]",
  "/jobs/[id]/postular",
  "/jobs/new",
  "/jobs/pending-jd",
  "/mercado/[carrera]",
  "/ofertas/[carrera]",
];

const UUID_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUMERIC_SEGMENT = /^\d+$/;
const DYNAMIC = /^\[[a-z]+\]$/i;

const PATTERNS = SCREEN_ROUTE_PATTERNS.map((p) => p.split("/").slice(1));

/** Cuántos segmentos fijos coinciden con la ruta, o -1 si no es esa ruta. */
function matchScore(segments: readonly string[], pattern: readonly string[]): number {
  if (segments.length !== pattern.length) return -1;
  let literal = 0;
  for (let i = 0; i < pattern.length; i++) {
    const want = pattern[i]!;
    const got = segments[i]!;
    if (DYNAMIC.test(want)) {
      if (got === "") return -1;
    } else if (want === got) {
      literal++;
    } else {
      return -1;
    }
  }
  return literal;
}

/**
 * `/jobs/<uuid>?x=1#y` → `/jobs/[id]`. Saca query y fragmento y la barra final; busca la ruta conocida
 * con más segmentos fijos (así `/jobs/new` gana a `/jobs/[id]`); si ninguna coincide, los segmentos con
 * forma de uuid o solo números pasan a `[id]` y el resto se conserva. Idempotente. Una entrada que no
 * es texto o está vacía da `/`.
 */
export function normalizeScreenPath(input: string): string {
  if (typeof input !== "string") return "/";
  const bare = (input.split("#")[0] ?? "").split("?")[0] ?? "";
  const trimmed = bare.replace(/\/+$/, "");
  if (trimmed === "") return "/";
  const segments = (trimmed.startsWith("/") ? trimmed : `/${trimmed}`).split("/").slice(1);

  let best: readonly string[] | null = null;
  let bestScore = -1;
  for (const pattern of PATTERNS) {
    const score = matchScore(segments, pattern);
    if (score > bestScore) {
      best = pattern;
      bestScore = score;
    }
  }
  if (best) return `/${best.join("/")}`;

  return `/${segments
    .map((seg) => (UUID_SEGMENT.test(seg) || NUMERIC_SEGMENT.test(seg) ? "[id]" : seg))
    .join("/")}`;
}

export type ScreenGroup = { screen: string; count: number; nuevos: number };

/** Los comentarios agrupados por pantalla: más comentadas primero; con el mismo conteo, por orden alfabético. */
export function groupFeedbackByScreen(
  rows: readonly { path: string; status: string }[],
): ScreenGroup[] {
  const groups = new Map<string, ScreenGroup>();
  for (const r of rows) {
    const screen = normalizeScreenPath(r.path);
    const g = groups.get(screen) ?? { screen, count: 0, nuevos: 0 };
    g.count++;
    if (r.status === "nuevo") g.nuevos++;
    groups.set(screen, g);
  }
  return [...groups.values()].sort(
    (a, b) => b.count - a.count || a.screen.localeCompare(b.screen, "es"),
  );
}
