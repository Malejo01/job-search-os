import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// La acción de la web importa "@/lib/..." y no se puede cargar acá: se fija sobre su código fuente
// (mismo enfoque que mcp/route-source.test.ts). El comportamiento de `onlyPending` lo cubre
// attach-jd.integration.test.ts.
const action = readFileSync(
  new URL("../../../../apps/web/app/(app)/jobs/pending-jd/actions.ts", import.meta.url),
  "utf8",
)
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");

describe("la acción de pegar JD en la web", () => {
  it("solo escribe sobre ofertas que esperan su JD", () => {
    expect(action).toMatch(/attachJd\(userId, jobId, text, \{ onlyPending: true \}\)/);
  });

  it("si la oferta ya no espera JD, vuelve a la página con un error y no sigue", () => {
    expect(action).toMatch(/JdNotPendingError"\) redirect\(/);
  });
});
