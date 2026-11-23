import { describe, expect, it } from "vitest";
import {
  APERTURA_VARS,
  buildAperturaChecklist,
  type AperturaInput,
  type AperturaItem,
} from "./apertura-checklist";

const NOW = new Date("2026-11-23T12:00:00Z");

function allGood(over: Partial<AperturaInput> = {}): AperturaInput {
  return {
    now: NOW,
    opensAt: new Date("2026-12-01T03:00:00Z"),
    vars: APERTURA_VARS.map((name) => ({ name, present: true })),
    textos: { total: 9, approved: 9 },
    academy: { approved: 6, total: 6 },
    mascota: { total: 6, missing: [] },
    routing: { expected: ["a", "b"], present: ["a", "b", "c"] },
    mp: { lista: true, tester50: true },
    invitations: { unused: 12 },
    ...over,
  };
}

const item = (items: AperturaItem[], id: string) => items.find((i) => i.id === id)!;

describe("buildAperturaChecklist", () => {
  it("con todo en orden no queda nada pendiente", () => {
    const r = buildAperturaChecklist(allGood());
    expect(r.pending).toBe(0);
    expect(r.total).toBe(r.items.length);
    expect(r.items.every((i) => i.ok && i.todo === null)).toBe(true);
  });

  it("cada pendiente dice qué hacer y en qué doc está", () => {
    const r = buildAperturaChecklist(
      allGood({
        vars: [{ name: "RESEND_API_KEY", present: false }],
        textos: { total: 9, approved: 2 },
        academy: { approved: 1, total: 6 },
        mascota: { total: 6, missing: ["quieta", "cara-48"] },
        routing: { expected: ["a", "b"], present: ["a"] },
        mp: { lista: false, tester50: true },
        invitations: { unused: 0 },
      }),
    );
    const pendientes = r.items.filter((i) => !i.ok);
    expect(pendientes.length).toBeGreaterThanOrEqual(7);
    for (const p of pendientes) {
      expect(p.todo).toMatch(/\S/);
      expect(p.doc).toMatch(/^(docs\/|\/settings\/|\/admin\/|apps\/|packages\/)/);
    }
    expect(r.pending).toBe(pendientes.length);
  });

  it("variables: lista los nombres que faltan, nunca valores", () => {
    const r = buildAperturaChecklist(
      allGood({
        vars: [
          { name: "RESEND_API_KEY", present: false },
          { name: "EMAIL_FROM", present: true },
        ],
      }),
    );
    const v = item(r.items, "variables");
    expect(v.ok).toBe(false);
    expect(v.detail).toContain("RESEND_API_KEY");
    expect(v.detail).not.toContain("EMAIL_FROM");
  });

  it("fecha de apertura: dice cuántos días faltan o que ya pasó", () => {
    const antes = item(buildAperturaChecklist(allGood()).items, "fecha");
    expect(antes.ok).toBe(true);
    expect(antes.detail).toMatch(/1 de diciembre/);
    expect(antes.detail).toMatch(/faltan 7 días|faltan 8 días/);
    const despues = item(
      buildAperturaChecklist(allGood({ now: new Date("2026-12-05T12:00:00Z") })).items,
      "fecha",
    );
    expect(despues.detail).toMatch(/ya abrió/);
  });

  it("fecha inválida es pendiente", () => {
    const r = buildAperturaChecklist(allGood({ opensAt: new Date("x") }));
    expect(item(r.items, "fecha").ok).toBe(false);
  });

  it("textos: cuenta los que siguen con el valor por defecto", () => {
    const r = buildAperturaChecklist(allGood({ textos: { total: 9, approved: 2 } }));
    const t = item(r.items, "textos");
    expect(t.ok).toBe(false);
    expect(t.detail).toMatch(/7 de 9/);
  });

  it("Academy: aprobadas sobre el total; sin fichas o sin lectura es pendiente", () => {
    expect(item(buildAperturaChecklist(allGood()).items, "academy").detail).toMatch(/6 de 6/);
    const parcial = buildAperturaChecklist(allGood({ academy: { approved: 1, total: 6 } }));
    expect(item(parcial.items, "academy").ok).toBe(false);
    expect(item(parcial.items, "academy").detail).toMatch(/1 de 6/);
    for (const academy of [{ approved: 0, total: 0 }, null]) {
      expect(item(buildAperturaChecklist(allGood({ academy })).items, "academy").ok).toBe(false);
    }
  });

  it("mascota: nombra las imágenes que faltan", () => {
    const r = buildAperturaChecklist(
      allGood({ mascota: { total: 6, missing: ["quieta", "cara-48"] } }),
    );
    const m = item(r.items, "mascota");
    expect(m.ok).toBe(false);
    expect(m.detail).toMatch(/4 de 6/);
    expect(m.detail).toContain("quieta");
  });

  it("model_routing: lista las tareas esperadas que faltan; las de más no molestan", () => {
    const r = buildAperturaChecklist(
      allGood({ routing: { expected: ["a", "b", "c"], present: ["a", "z"] } }),
    );
    const m = item(r.items, "routing");
    expect(m.ok).toBe(false);
    expect(m.detail).toMatch(/1 de 3/);
    expect(m.detail).toContain("b");
    expect(m.detail).toContain("c");
    expect(item(buildAperturaChecklist(allGood({ routing: null })).items, "routing").ok).toBe(
      false,
    );
  });

  it("Mercado Pago: pendiente si falta cualquiera de los dos links, sin mostrar valores", () => {
    const sinLista = item(
      buildAperturaChecklist(allGood({ mp: { lista: false, tester50: true } })).items,
      "mercadopago",
    );
    expect(sinLista.ok).toBe(false);
    expect(sinLista.detail).toContain("MP_LINK_LISTA");
    expect(sinLista.detail).not.toContain("MP_LINK_TESTER_50");
    const sinTester = item(
      buildAperturaChecklist(allGood({ mp: { lista: true, tester50: false } })).items,
      "mercadopago",
    );
    expect(sinTester.ok).toBe(false);
    expect(sinTester.detail).toContain("MP_LINK_TESTER_50");
  });

  it("invitaciones sin usar: con 0 o sin lectura es pendiente", () => {
    expect(item(buildAperturaChecklist(allGood()).items, "invitaciones").detail).toMatch(/12/);
    for (const invitations of [{ unused: 0 }, null]) {
      expect(item(buildAperturaChecklist(allGood({ invitations })).items, "invitaciones").ok).toBe(
        false,
      );
    }
  });

  it("las variables que mira son solo nombres conocidos y no incluyen secretos de base", () => {
    expect(APERTURA_VARS).toContain("RESEND_API_KEY");
    expect(APERTURA_VARS).not.toContain("DATABASE_URL");
    expect(APERTURA_VARS).not.toContain("AUTH_SECRET");
  });
});
