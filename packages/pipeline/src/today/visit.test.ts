import { describe, expect, it } from "vitest";
import { VISIT_COOKIE, VISIT_WINDOW_MS, visitWindow } from "./visit";

const USER = "11111111-2222-3333-4444-555555555555";
const NOW = new Date("2026-10-21T12:00:00.000Z");
const nowSec = NOW.getTime() / 1000;

describe("visitWindow", () => {
  it("exporta las constantes", () => {
    expect(VISIT_COOKIE).toBe("jso_ultima_visita");
    expect(VISIT_WINDOW_MS).toBe(30 * 60 * 1000);
  });

  it("sin cookie: sin desde y sello nuevo", () => {
    expect(visitWindow(undefined, USER, NOW)).toEqual({
      since: null,
      stamp: `${USER}.0.${nowSec}`,
    });
  });

  it("cookie de otro usuario: se trata como sin cookie", () => {
    const r = visitWindow(`otro.100.${nowSec - 10}`, USER, NOW);
    expect(r).toEqual({ since: null, stamp: `${USER}.0.${nowSec}` });
  });

  it("cookie corrupta", () => {
    for (const c of [
      "basura",
      `${USER}.a.b`,
      `${USER}.-5.${nowSec}`,
      `${USER}.1.2.3`,
      `${USER}.1.${nowSec + 2 * 24 * 3600}`,
      `${USER}.${nowSec}.${nowSec - 100}`,
      "",
    ]) {
      expect(visitWindow(c, USER, NOW)).toEqual({ since: null, stamp: `${USER}.0.${nowSec}` });
    }
  });

  it("misma visita: desde la anterior y sin reescribir", () => {
    const prev = nowSec - 86400;
    const r = visitWindow(`${USER}.${prev}.${nowSec - 60}`, USER, NOW);
    expect(r.since).toEqual(new Date(prev * 1000));
    expect(r.stamp).toBeNull();
  });

  it("misma visita con anterior = 0: since null", () => {
    expect(visitWindow(`${USER}.0.${nowSec - 60}`, USER, NOW)).toEqual({
      since: null,
      stamp: null,
    });
  });

  it("visita nueva: desde la actual y se desplaza el sello", () => {
    const cur = nowSec - 3600;
    const r = visitWindow(`${USER}.5.${cur}`, USER, NOW);
    expect(r.since).toEqual(new Date(cur * 1000));
    expect(r.stamp).toBe(`${USER}.${cur}.${nowSec}`);
  });

  it("frontera: exactamente 30 min es la misma visita, un segundo más es nueva", () => {
    const edge = nowSec - 30 * 60;
    expect(visitWindow(`${USER}.7.${edge}`, USER, NOW).stamp).toBeNull();
    const over = visitWindow(`${USER}.7.${edge - 1}`, USER, NOW);
    expect(over.stamp).toBe(`${USER}.${edge - 1}.${nowSec}`);
  });
});
