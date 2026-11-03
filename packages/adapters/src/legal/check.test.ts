import { describe, expect, it } from "vitest";
import { runLegalCheck } from "./check";

const files = [
  { path: "terminos.md", content: "Lo ofrece **[RESPONSABLE]**.\nPrecio: [A DEFINIR con Ani]." },
  { path: "privacidad.md", content: "Escribí a [EMAIL DE CONTACTO]." },
];
const ENV = { LEGAL_RESPONSABLE: "Responsable de Prueba", LEGAL_EMAIL: "x@example.com" };

describe("runLegalCheck (C8-12)", () => {
  it("lista cada faltante con archivo:línea y no falla sin LEGAL_FINAL", () => {
    const r = runLegalCheck({ files, env: {}, final: false });
    expect(r.ok).toBe(true);
    expect(r.missing).toBe(3);
    expect(r.lines[0]).toBe("terminos.md:1  [RESPONSABLE]  → falta la variable LEGAL_RESPONSABLE");
    expect(r.lines[1]).toContain("terminos.md:2  [A DEFINIR");
    expect(r.lines[2]).toContain("privacidad.md:1  [EMAIL DE CONTACTO]");
  });

  it("con LEGAL_FINAL=1 falla si queda alguno", () => {
    expect(runLegalCheck({ files, env: ENV, final: true }).ok).toBe(false);
  });

  it("con todo completo pasa aunque sea final", () => {
    const done = [{ path: "t.md", content: "Lo ofrece [RESPONSABLE]." }];
    const r = runLegalCheck({ files: done, env: ENV, final: true });
    expect(r).toMatchObject({ ok: true, missing: 0 });
  });
});
