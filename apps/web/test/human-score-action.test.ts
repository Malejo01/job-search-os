import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Las Server Actions no tienen un patrón de prueba unitaria acá (el vitest de la web no resuelve el
 * alias `@/`), así que este test cuida la regla en el código fuente: `humanScoreAction` pregunta
 * `canViewRecorrido` (tester o admin) ANTES de guardar, y redirige sin guardar si la respuesta es no.
 * El comportamiento completo lo cubre el e2e 36 con una cuenta tester/admin.
 */
const source = readFileSync(new URL("../app/(app)/jobs/[id]/actions.ts", import.meta.url), "utf8");
const start = source.indexOf("export async function humanScoreAction");
const body = source.slice(start, source.indexOf("\n}\n", start));

describe("humanScoreAction: solo testers y admins", () => {
  it("existe y valida el permiso en el servidor", () => {
    expect(start).toBeGreaterThan(-1);
    expect(body).toContain("canViewRecorrido(userId)");
  });

  it("rechaza (redirect) antes de guardar", () => {
    const check = body.indexOf("canViewRecorrido(userId)");
    const redirectAt = body.indexOf("redirect(", check);
    const saveAt = body.indexOf("saveHumanScore(");
    expect(check).toBeGreaterThan(-1);
    expect(redirectAt).toBeGreaterThan(check);
    expect(saveAt).toBeGreaterThan(redirectAt);
    expect(body.slice(check - 12, redirectAt)).toMatch(/!\s*\(await canViewRecorrido/);
  });
});
