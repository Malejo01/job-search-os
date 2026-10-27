import { describe, expect, it } from "vitest";
import type { JobRow } from "./metrics";
import { diagnose, makeSplit, metricsOn, seededRandom, type ReportLike } from "./split";

const ACTIONS = ["aplicar", "guardar", "descartar"] as const;

function inputs(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    accion: ACTIONS[i % 3]!,
    human_risks:
      i % 4 === 0 ? ["LATAM sin países explícitos"] : i % 5 === 0 ? ["Muchos candidatos"] : [],
  }));
}

function row(id: number, over: Partial<JobRow> = {}): JobRow {
  return {
    id,
    human_score: 6,
    human_score_match: 6,
    human_blockers: [],
    human_blockers_legacy: [],
    human_risks: [],
    human_discipline: "ai_engineer",
    human_action: "guardar",
    human_location_ok: "ok",
    human_location_ok_clean: "ok",
    model_score: 6,
    scores: [6],
    model_blockers: [],
    model_risks: [],
    model_discipline: "ai_engineer",
    model_action: "guardar",
    model_location_ok: "ok",
    unstable: false,
    ...over,
  };
}

const report = (jobs: JobRow[]): ReportLike => ({
  meta: { prompt: "evaluate_job@v1.3.4", model: "m", cost_usd: 0 },
  metrics: { apply_floor: 5 },
  jobs,
});

describe("makeSplit", () => {
  const jobs = [
    ...inputs(36),
    ...[101, 102, 103, 104].map((id) => ({
      id,
      accion: "descartar",
      human_risks: [],
      adversarial: true,
    })),
  ];

  it("es determinista con la misma semilla y cambia con otra", () => {
    expect(makeSplit(jobs, 7)).toEqual(makeSplit(jobs, 7));
    expect(makeSplit(jobs, 7).dev).not.toEqual(makeSplit(jobs, 8).dev);
  });

  it("reparte 18 y 18, sin repetir, y los adversariales van aparte", () => {
    const s = makeSplit(jobs, 7);
    expect(s.dev).toHaveLength(18);
    expect(s.test).toHaveLength(18);
    expect(s.adversarial).toEqual([101, 102, 103, 104]);
    expect(new Set([...s.dev, ...s.test]).size).toBe(36);
  });

  it("cada acción queda repartida con una diferencia de a lo sumo 1 entre lados", () => {
    const s = makeSplit(jobs, 7);
    const byId = new Map(jobs.map((j) => [j.id, j]));
    for (const a of ACTIONS) {
      const d = s.dev.filter((id) => byId.get(id)!.accion === a).length;
      const t = s.test.filter((id) => byId.get(id)!.accion === a).length;
      expect(Math.abs(d - t)).toBeLessThanOrEqual(2);
    }
  });

  it("los casos con riesgo humano de ubicación caen en los dos lados", () => {
    const s = makeSplit(jobs, 7);
    const loc = new Set(
      jobs.filter((j) => j.human_risks.some((r) => /LATAM/.test(r))).map((j) => j.id),
    );
    expect(s.dev.some((id) => loc.has(id))).toBe(true);
    expect(s.test.some((id) => loc.has(id))).toBe(true);
  });

  it("seededRandom devuelve valores en [0, 1)", () => {
    const r = seededRandom(1);
    for (let i = 0; i < 100; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("metricsOn", () => {
  it("calcula solo sobre los ids pedidos", () => {
    const rep = report([
      row(1, { human_action: "aplicar", model_action: "aplicar" }),
      row(2, { human_action: "aplicar", model_action: "descartar" }),
      row(3, { human_action: "guardar", model_action: "guardar" }),
    ]);
    expect(metricsOn(rep, [1, 3]).action_acc).toBe(1);
    expect(metricsOn(rep, [1, 2]).action_acc).toBe(0.5);
    expect(metricsOn(rep, [2]).n_jobs).toBe(1);
  });

  it("deja los adversariales fuera de las métricas de D-019 y dentro de la resistencia", () => {
    const rep = report([
      row(1),
      row(101, {
        adversarial: true,
        human_score_match: 1,
        model_score: 2,
        model_action: "descartar",
      }),
    ]);
    const m = metricsOn(rep, [1, 101]);
    expect(m.n_jobs).toBe(1);
    expect(m.injection_resistance?.n).toBe(1);
  });
});

describe("diagnose", () => {
  it("cuenta por categoría y por id, en cuántos reportes ocurre", () => {
    const bad = row(5, {
      human_blockers: ["disciplina distinta (data)"],
      model_blockers: ["Inglés avanzado requerido"],
      human_discipline: "data",
      model_discipline: "otra",
      human_location_ok_clean: "riesgo",
      model_location_ok: "ok",
      human_action: "descartar",
      model_action: "guardar",
      human_score_match: 2,
      model_score: 5,
    });
    const d = diagnose([report([bad]), report([bad])], [5]);
    expect(d.bloqueantes_faltantes.disciplina).toEqual({ 5: 2 });
    expect(d.bloqueantes_de_mas.otro).toEqual({ 5: 2 });
    expect(d.disciplina["data→otra"]).toEqual({ 5: 2 });
    expect(d.ubicacion["riesgo→ok"]).toEqual({ 5: 2 });
    expect(d.idioma.bloquea_por_ingles).toEqual({ 5: 2 });
    expect(d.puntaje.sobre_estima_2).toBeUndefined();
    expect(d.puntaje["sobre_estima_2+"]).toEqual({ 5: 2 });
    expect(d.accion["descartar→guardar"]).toEqual({ 5: 2 });
  });

  it("ignora los casos fuera del subconjunto y los que no tienen respuesta", () => {
    const d = diagnose(
      [report([row(1, { model_discipline: "otra" }), row(2, { model_score: null })])],
      [2],
    );
    expect(d.disciplina).toEqual({});
  });
});
