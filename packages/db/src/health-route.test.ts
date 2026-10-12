import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Test sobre el código fuente: la ruta importa "@/lib/db" (alias de apps/web) y la base, así que
// no se puede cargar acá. Límite: verifica la forma del código, no el comportamiento en runtime;
// eso lo confirma Mauro comparando el commit de /api/health con el de Vercel tras el deploy.
const source = readFileSync(
  new URL("../../../apps/web/app/api/health/route.ts", import.meta.url),
  "utf8",
);

describe("/api/health (JS-129)", () => {
  it("es dinámica", () => {
    expect(source).toMatch(/export const dynamic = "force-dynamic"/);
  });

  it("lee VERCEL_GIT_COMMIT_SHA dentro del handler, no a nivel de módulo", () => {
    const handlerStart = source.indexOf("export async function GET");
    expect(handlerStart).toBeGreaterThan(-1);
    expect(source.slice(0, handlerStart)).not.toContain("VERCEL_GIT_COMMIT_SHA");
    expect(source.slice(handlerStart)).toContain("process.env.VERCEL_GIT_COMMIT_SHA");
  });

  it("fija Cache-Control: no-store en las respuestas 200 y 503", () => {
    expect(source).toMatch(/NO_STORE = \{ "Cache-Control": "no-store" \}/);
    expect(source.match(/headers: NO_STORE/g)).toHaveLength(2);
  });
});
