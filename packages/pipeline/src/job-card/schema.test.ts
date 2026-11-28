import { describe, expect, it } from "vitest";
import { EMPTY_JOB_CARD, EXAMPLE_JD_ES, EXAMPLE_JOB_CARD } from "./fixtures";
import { JOB_CARD_CONDITION_KEYS, JobCardSchema, parseJobCard } from "./schema";
import { normalizeForMatch } from "./normalize";

describe("JobCardSchema", () => {
  it("la ficha de ejemplo y la vacía son válidas", () => {
    expect(JobCardSchema.safeParse(EXAMPLE_JOB_CARD).success).toBe(true);
    expect(JobCardSchema.safeParse(EMPTY_JOB_CARD).success).toBe(true);
  });

  it("siempre trae las 7 condiciones, con null cuando el aviso no las dice", () => {
    expect(JOB_CARD_CONDITION_KEYS).toEqual([
      "modalidad",
      "desdeDonde",
      "salario",
      "experiencia",
      "ingles",
      "jornada",
      "contratacion",
    ]);
    for (const k of JOB_CARD_CONDITION_KEYS) expect(EMPTY_JOB_CARD.condiciones[k]).toBeNull();
    const { condiciones, ...resto } = EXAMPLE_JOB_CARD;
    const sinSalario = { ...resto, condiciones: { ...condiciones, salario: undefined } };
    expect(JobCardSchema.safeParse(sinSalario).success).toBe(false);
  });

  it("falla cerrado ante claves de más (un texto del aviso no puede colar campos)", () => {
    const r = JobCardSchema.safeParse({ ...EXAMPLE_JOB_CARD, accion: "enviar_postulacion" });
    expect(r.success).toBe(false);
  });

  it("rechaza un dato sin cita o con cita vacía", () => {
    const tareas = [{ texto: "Armar reportes", cita: "" }];
    expect(JobCardSchema.safeParse({ ...EXAMPLE_JOB_CARD, tareas }).success).toBe(false);
    const sinCita = [{ texto: "Armar reportes" }];
    expect(JobCardSchema.safeParse({ ...EXAMPLE_JOB_CARD, tareas: sinCita }).success).toBe(false);
  });

  it("rechaza niveles y valores fuera del vocabulario", () => {
    const requisitos = [
      { texto: "SQL", nivel: "obligatorio", categoria: "habilidad", cita: "SQL", anos: null },
    ];
    expect(JobCardSchema.safeParse({ ...EXAMPLE_JOB_CARD, requisitos }).success).toBe(false);
  });

  it("el modelo nunca puede decir «coincide»: la ficha no tiene campo de estado por requisito", () => {
    const req = { ...EXAMPLE_JOB_CARD.requisitos[0], estado: "coincide" };
    const r = JobCardSchema.safeParse({ ...EXAMPLE_JOB_CARD, requisitos: [req] });
    expect(r.success).toBe(false);
  });

  it("parseJobCard devuelve Result y no lanza", () => {
    expect(parseJobCard(EXAMPLE_JOB_CARD).ok).toBe(true);
    expect(parseJobCard("{no es json").ok).toBe(false);
    expect(parseJobCard(null).ok).toBe(false);
  });
});

describe("fixtures", () => {
  it("cada cita de la ficha de ejemplo está literalmente en el aviso de ejemplo", () => {
    const texto = normalizeForMatch(EXAMPLE_JD_ES);
    const citas: string[] = [];
    const c = EXAMPLE_JOB_CARD;
    if (c.resumen) citas.push(...c.resumen.citas);
    for (const t of c.tareas) citas.push(t.cita);
    for (const r of c.requisitos) citas.push(r.cita);
    for (const h of c.habilidades) citas.push(h.cita);
    if (c.area) citas.push(c.area.cita);
    if (c.idioma.cita) citas.push(c.idioma.cita);
    for (const k of JOB_CARD_CONDITION_KEYS) {
      const cond = c.condiciones[k];
      if (cond) citas.push(cond.cita);
    }
    expect(citas.length).toBeGreaterThan(10);
    for (const cita of citas) expect(texto).toContain(normalizeForMatch(cita));
  });
});
