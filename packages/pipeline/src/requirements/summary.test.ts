import { describe, expect, it } from "vitest";
import type { ChecklistItem } from "../evaluator/checklist";
import { summarizeRequirements } from "./summary";

const item = (over: Partial<ChecklistItem> & Pick<ChecklistItem, "id" | "status">) =>
  ({
    kind: "estructurado",
    nivel: "must",
    evidencia: null,
    pide: "Pide algo",
    tenes: "dato del perfil",
    fuente: { pide: "fuente", tenes: "perfil" },
    bloquea: false,
    ...over,
  }) as ChecklistItem;

const run = (...items: ChecklistItem[]) => summarizeRequirements({ items });

describe("summarizeRequirements", () => {
  it("sin checklist o vacío: todo en cero", () => {
    for (const r of [summarizeRequirements(null), summarizeRequirements(undefined), run()]) {
      expect(r.counts).toEqual({ coincide: 0, sinConfirmar: 0, noCoincide: 0 });
      expect(r.blocking).toBeNull();
      expect(r.weighing).toEqual([]);
      expect(r.cardUnconfirmed).toEqual([]);
    }
  });

  it("cuenta con los tres estados de la tabla", () => {
    const r = run(
      item({ id: "modalidad", status: "cumple" }),
      item({ id: "anos", status: "no_se_sabe", tenes: null }),
      item({ id: "ingles", status: "no_cumple" }),
      item({ id: "salario", status: "cumple" }),
    );
    expect(r.counts).toEqual({ coincide: 2, sinConfirmar: 1, noCoincide: 1 });
  });

  it("los conteos salen de las mismas filas que el resto (no hay otra fuente)", () => {
    const r = run(
      item({ id: "pais", status: "no_cumple", bloquea: true }),
      item({ id: "anos", status: "no_se_sabe", tenes: null }),
    );
    const total = r.counts.coincide + r.counts.sinConfirmar + r.counts.noCoincide;
    expect(total).toBe(r.rows.length);
  });

  it("regla 2.1: no_cumple sin dato en el perfil se trata como Sin confirmar", () => {
    const r = run(
      item({ id: "residencia", status: "no_cumple", bloquea: true, tenes: null }),
      item({ id: "jornada", status: "no_cumple", tenes: null }),
    );
    expect(r.counts).toEqual({ coincide: 0, sinConfirmar: 2, noCoincide: 0 });
    expect(r.blocking).toBeNull();
    expect(r.rows.every((x) => x.demoted && !x.excluding)).toBe(true);
    expect(r.cardUnconfirmed.map((x) => x.id)).toEqual(["residencia", "jornada"]);
  });

  it("no_cumple con dato explícito distinto es No coincide y, si bloquea, es la condición excluyente", () => {
    const r = run(
      item({ id: "modalidad", status: "cumple" }),
      item({
        id: "residencia",
        status: "no_cumple",
        bloquea: true,
        pide: "Residir en EE. UU.",
        tenes: "AR",
      }),
    );
    expect(r.blocking?.id).toBe("residencia");
    expect(r.blocking?.code).toBe("residencia");
    expect(r.blocking?.state).toBe("noCoincide");
    expect(r.blocking?.excluding).toBe(true);
    expect(r.counts.noCoincide).toBe(1);
  });

  it("residencia es más específica que país: gana como excluyente (S-02)", () => {
    const r = run(
      item({ id: "pais", status: "no_cumple", bloquea: true, tenes: "AR" }),
      item({ id: "residencia", status: "no_cumple", bloquea: true, tenes: "AR" }),
    );
    expect(r.blocking?.id).toBe("residencia");
  });

  it("autorización de trabajo y residencia son filas distintas y no se pisan (S-03)", () => {
    const r = run(
      item({ id: "autorizacion", status: "no_cumple", bloquea: true, tenes: "Sin autorización" }),
      item({ id: "residencia", status: "no_cumple", bloquea: true, tenes: "AR" }),
    );
    expect(r.rows.map((x) => x.code).sort()).toEqual(["autorizacion", "residencia"]);
    expect(r.counts.noCoincide).toBe(2);
  });

  it("un deseable que no coincide nunca es excluyente, aunque diga bloquea", () => {
    const r = run(
      item({ id: "skill:x", kind: "skill", nivel: "deseable", status: "no_cumple", bloquea: true }),
    );
    expect(r.blocking).toBeNull();
    expect(r.rows[0]!.code).toBe("skill");
  });

  it("un must que no coincide pero no bloquea no es excluyente", () => {
    const r = run(item({ id: "anos", status: "no_cumple", bloquea: false, tenes: "2 años" }));
    expect(r.blocking).toBeNull();
    expect(r.counts.noCoincide).toBe(1);
  });

  it("lo que más pesa: excluyente, no coincide, must sin confirmar, must que coincide, deseables; máximo 3", () => {
    const r = run(
      item({ id: "skill:a", kind: "skill", nivel: "deseable", status: "cumple" }),
      item({ id: "ingles", status: "cumple" }),
      item({ id: "anos", status: "no_se_sabe", tenes: null }),
      item({ id: "pais", status: "no_cumple", bloquea: true, tenes: "AR" }),
      item({ id: "modalidad", status: "cumple" }),
    );
    expect(r.weighing.map((x) => x.id)).toEqual(["pais", "anos", "ingles"]);
  });

  it("lo que más pesa incluye un must que no coincide sin ser excluyente, antes del sin confirmar", () => {
    const r = run(
      item({ id: "anos", status: "no_se_sabe", tenes: null }),
      item({ id: "jornada", status: "no_cumple", tenes: "Máximo 40 h" }),
    );
    expect(r.weighing.map((x) => x.id)).toEqual(["jornada", "anos"]);
  });

  it("los deseables completan cuando faltan musts", () => {
    const r = run(
      item({ id: "ingles", status: "cumple" }),
      item({ id: "skill:a", kind: "skill", nivel: "deseable", status: "cumple" }),
      item({ id: "skill:b", kind: "skill", nivel: "deseable", status: "no_se_sabe", tenes: null }),
    );
    expect(r.weighing.map((x) => x.id)).toEqual(["ingles", "skill:b", "skill:a"]);
  });

  it("tarjeta: hasta 2 sin confirmar, los must primero y las habilidades al final", () => {
    const r = run(
      item({ id: "skill:a", kind: "skill", nivel: "deseable", status: "no_se_sabe", tenes: null }),
      item({ id: "anos", status: "no_se_sabe", tenes: null }),
      item({ id: "ingles", status: "no_se_sabe", tenes: null }),
      item({ id: "salario", status: "no_se_sabe", tenes: null }),
    );
    expect(r.cardUnconfirmed.map((x) => x.id)).toEqual(["anos", "ingles"]);
    expect(r.cardUnconfirmed.length).toBeLessThanOrEqual(2);
  });

  it("tarjeta: nunca lista algo que coincide o no coincide", () => {
    const r = run(
      item({ id: "anos", status: "cumple" }),
      item({ id: "ingles", status: "no_cumple", tenes: "A2" }),
    );
    expect(r.cardUnconfirmed).toEqual([]);
  });

  it("el ítem original viaja intacto en la fila (no se reescribe la tabla)", () => {
    const it0 = item({ id: "ingles", status: "no_cumple", tenes: null, pide: "Inglés avanzado" });
    const r = run(it0);
    expect(r.rows[0]!.item).toBe(it0);
    expect(r.rows[0]!.state).toBe("sinConfirmar");
  });

  it("código desconocido cae en 'otro' y req:<n> en 'req'", () => {
    const r = run(item({ id: "xyz", status: "cumple" }), item({ id: "req:3", status: "cumple" }));
    expect(r.rows.map((x) => x.code)).toEqual(["otro", "req"]);
  });
});
