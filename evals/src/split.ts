import {
  anchorBlockers,
  anchorFor,
  anchorLocation,
  classifyBlocker,
  classifyRisk,
  computeMetrics,
  sameAction,
  type JobRow,
  type Metrics,
} from "./metrics";

/**
 * Split dev/test del golden (C-26) y métricas de un reporte sobre un subconjunto de casos.
 * Funciones puras, sin I/O: el golden y los reportes los carga quien las llama. Solo hay ids,
 * enums y números; nada del texto de las ofertas.
 */

export type SplitInput = {
  id: number;
  accion: string;
  human_risks: readonly string[];
  adversarial?: boolean;
};

export type Split = {
  seed: number;
  /** Ids con los que se afina el prompt. */
  dev: number[];
  /** Ids que no se miran hasta la comparación final (sin los adversariales). */
  test: number[];
  /** Avisos manipulados: van siempre al test, aparte de D-019. */
  adversarial: number[];
};

/** PRNG determinista (mulberry32): la misma semilla da siempre el mismo split. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const normAction = (a: string) => (a === "aplicar_personalizado" ? "aplicar" : a);

/**
 * Estrato = acción humana × si tiene riesgo humano de ubicación. Dentro de cada estrato se
 * reparten los casos de a uno al lado que tenga menos (desempate: el que tenga menos en total, y
 * después la semilla), con los casos que tienen otros tipos de riesgo mezclados primero para que
 * también se repartan parejo.
 */
export function makeSplit(jobs: readonly SplitInput[], seed: number): Split {
  const rand = seededRandom(seed);
  const base = jobs.filter((j) => !j.adversarial).sort((a, b) => a.id - b.id);
  const adversarial = jobs
    .filter((j) => j.adversarial)
    .map((j) => j.id)
    .sort((a, b) => a - b);

  const strata = new Map<string, SplitInput[]>();
  for (const j of base) {
    const loc = j.human_risks.some((r) => classifyRisk(r) === "ubicacion") ? "L" : "-";
    const key = `${normAction(j.accion)}|${loc}`;
    strata.set(key, [...(strata.get(key) ?? []), j]);
  }

  const dev: number[] = [];
  const test: number[] = [];
  for (const key of [...strata.keys()].sort()) {
    const members = strata.get(key)!;
    const other = (j: SplitInput) =>
      j.human_risks.some((r) => !["ubicacion", "salario"].includes(classifyRisk(r))) ? 1 : 0;
    // Mezcla con la semilla y después agrupa por "tiene otro riesgo": un orden estable y repartible
    const shuffled = members
      .map((j) => ({ j, r: rand() }))
      .sort((a, b) => a.r - b.r)
      .map((x) => x.j)
      .sort((a, b) => other(a) - other(b));
    let devHere = 0;
    let testHere = 0;
    for (const j of shuffled) {
      const toDev =
        devHere !== testHere
          ? devHere < testHere
          : dev.length !== test.length
            ? dev.length < test.length
            : rand() < 0.5;
      if (toDev) {
        dev.push(j.id);
        devHere++;
      } else {
        test.push(j.id);
        testHere++;
      }
    }
  }
  return {
    seed,
    dev: dev.sort((a, b) => a - b),
    test: test.sort((a, b) => a - b),
    adversarial,
  };
}

/** Un reporte, solo con lo que estas funciones necesitan. */
export type ReportLike = {
  meta: { prompt: string; model: string; label?: string; cost_usd: number | null };
  metrics: { apply_floor: number };
  jobs: (JobRow & { model_raw?: unknown })[];
};

export type SetName = "dev" | "test" | "test+adv" | "all";

export function idsOf(split: Split, set: SetName, allIds: readonly number[] = []): number[] {
  switch (set) {
    case "dev":
      return split.dev;
    case "test":
      return split.test;
    case "test+adv":
      return [...split.test, ...split.adversarial];
    case "all":
      return allIds.length ? [...allIds] : [...split.dev, ...split.test, ...split.adversarial];
  }
}

/** Mismas métricas que el reporte, pero solo sobre los casos pedidos (el ancla sale del prompt). */
export function metricsOn(report: ReportLike, ids: readonly number[]): Metrics {
  const wanted = new Set(ids);
  const rows = report.jobs.filter((j) => wanted.has(j.id));
  return computeMetrics(rows, anchorFor(report.meta.prompt), report.metrics.apply_floor);
}

type Numeric = Exclude<
  {
    [K in keyof Metrics]: Metrics[K] extends number | null ? K : never;
  }[keyof Metrics],
  undefined
>;

/** Media de una métrica numérica entre reportes (ignora los null); null si ninguno la tiene. */
export function meanOf(list: readonly Metrics[], key: Numeric): number | null {
  const v = list.map((m) => m[key]).filter((x): x is number => typeof x === "number");
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

export type Diagnosis = {
  n_reports: number;
  n_cases: number;
  /** id → en cuántos reportes ocurrió. Solo ids y enums. */
  bloqueantes_faltantes: Record<string, Record<number, number>>;
  bloqueantes_de_mas: Record<string, Record<number, number>>;
  disciplina: Record<string, Record<number, number>>;
  ubicacion: Record<string, Record<number, number>>;
  idioma: Record<string, Record<number, number>>;
  puntaje: Record<string, Record<number, number>>;
  accion: Record<string, Record<number, number>>;
};

const ENGLISH = /ingles|english|\bb1\b|\bb2\b|\bc1\b/i;
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");

function bump(bucket: Record<string, Record<number, number>>, label: string, id: number): void {
  const inner = (bucket[label] ??= {});
  inner[id] = (inner[id] ?? 0) + 1;
}

/**
 * Errores por categoría y por id sobre los casos pedidos, contando en cuántos de los reportes
 * aparece cada uno. Etiquetas de enum (tipo de bloqueador, disciplina, acción), nunca texto libre.
 */
export function diagnose(reports: readonly ReportLike[], ids: readonly number[]): Diagnosis {
  const wanted = new Set(ids);
  const d: Diagnosis = {
    n_reports: reports.length,
    n_cases: ids.length,
    bloqueantes_faltantes: {},
    bloqueantes_de_mas: {},
    disciplina: {},
    ubicacion: {},
    idioma: {},
    puntaje: {},
    accion: {},
  };
  for (const report of reports) {
    const anchor = anchorFor(report.meta.prompt);
    for (const r of report.jobs) {
      if (!wanted.has(r.id) || r.adversarial || r.model_score === null) continue;
      const H = new Set(anchorBlockers(r, anchor).map(classifyBlocker));
      const M = new Set(r.model_blockers.map(classifyBlocker));
      for (const t of H) if (!M.has(t)) bump(d.bloqueantes_faltantes, t, r.id);
      for (const t of M) if (!H.has(t)) bump(d.bloqueantes_de_mas, t, r.id);

      if (r.model_discipline !== null && r.model_discipline !== r.human_discipline) {
        bump(d.disciplina, `${r.human_discipline}→${r.model_discipline}`, r.id);
      }

      const humanLoc = anchorLocation(r, anchor);
      if (r.model_location_ok !== null && r.model_location_ok !== humanLoc) {
        bump(d.ubicacion, `${humanLoc}→${r.model_location_ok}`, r.id);
      }
      const humanLocRisk = humanLoc === "riesgo" || humanLoc === "no";
      if (humanLocRisk && !r.model_location_risk_final)
        bump(d.ubicacion, "riesgo_perdido_final", r.id);

      // Idioma: el modelo lo usa como bloqueador (la taxonomía lo cuenta como "otro") o como riesgo
      if (r.model_blockers.some((b) => ENGLISH.test(fold(b)))) {
        const humanHadEnglish = r.human_risks.some((x) => classifyRisk(x) === "ingles");
        bump(
          d.idioma,
          humanHadEnglish ? "bloquea_con_ingles_humano_lo_marca_riesgo" : "bloquea_por_ingles",
          r.id,
        );
      }
      if (
        r.human_risks.some((x) => classifyRisk(x) === "ingles") &&
        !r.model_risks.some((x) => classifyRisk(x) === "ingles") &&
        !r.model_blockers.some((b) => ENGLISH.test(fold(b)))
      ) {
        bump(d.idioma, "riesgo_ingles_perdido", r.id);
      }

      const a = anchor === "human_score" ? r.human_score : r.human_score_match;
      if (a !== null) {
        const delta = r.model_score - a;
        if (delta <= -2) bump(d.puntaje, "sub_estima_2+", r.id);
        else if (delta >= 2) bump(d.puntaje, "sobre_estima_2+", r.id);
      }

      if (r.model_action !== null && !sameAction(r.model_action, r.human_action)) {
        bump(d.accion, `${normAction(r.human_action)}→${normAction(r.model_action)}`, r.id);
      }
    }
  }
  return d;
}

/** Texto compacto: por categoría y etiqueta, cuántas veces y en qué ids (con "×k" si k > 1). */
export function formatDiagnosis(d: Diagnosis): string[] {
  const lines = [`${d.n_reports} reportes × ${d.n_cases} casos`];
  const sections: [string, Record<string, Record<number, number>>][] = [
    ["bloqueantes que el humano puso y el modelo no", d.bloqueantes_faltantes],
    ["bloqueantes del modelo que el humano no puso", d.bloqueantes_de_mas],
    ["disciplina distinta", d.disciplina],
    ["ubicación", d.ubicacion],
    ["idioma", d.idioma],
    ["puntaje (|delta| ≥ 2)", d.puntaje],
    ["acción distinta (humano→modelo)", d.accion],
  ];
  for (const [title, bucket] of sections) {
    const labels = Object.keys(bucket).sort();
    const total = labels.reduce(
      (acc, l) => acc + Object.values(bucket[l]!).reduce((a, b) => a + b, 0),
      0,
    );
    lines.push(`- ${title}: ${total} en total`);
    for (const l of labels) {
      const per = Object.entries(bucket[l]!)
        .sort((a, b) => Number(a[0]) - Number(b[0]))
        .map(([id, k]) => (k > 1 ? `${id}×${k}` : id))
        .join(", ");
      lines.push(`    · ${l}: ${per}`);
    }
  }
  return lines;
}
