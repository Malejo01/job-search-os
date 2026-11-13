import {
  buildEvaluateJobVars,
  decide,
  evaluationWireFor,
  outputSchemaFor,
  prefilter,
  type CriteriaRules,
  type Decision,
  type ProfileForPrompt,
} from "@job-search-os/pipeline";
import type { LlmClient } from "./types";

/**
 * R9-6 · Calidad de la evaluación por carrera con el modelo real. Lógica del harness, sin I/O: recibe
 * los avisos del golden sintético de carreras (`packages/pipeline/test/fixtures/carreras/`), una
 * persona de prueba por carrera, el cliente LLM y las reglas de criterios. El CLI
 * (`carreras-calidad-cli.ts`) lee los archivos, aplica el tope duro de gasto y escribe el informe.
 *
 * No usa `evals/fixtures/golden.json` ni toca `evals/` (que dispara el job pago del CI).
 */

type PrefilterModality = "remoto" | "hibrido" | "presencial";

export type CarreraCaso = {
  id: string;
  categoria: string;
  empresa: string;
  titulo: string;
  ubicacion_raw: string;
  modalidad: string;
  jd_text: string;
  etiquetas: {
    prefiltro: string;
    flags_esperados: string[];
    bloqueadores_esperados: string[];
    accion_esperada: string;
    score_esperado: { min: number; max: number };
  };
};

export type CarreraDoc = {
  meta: {
    carrera: string;
    persona: {
      pais: string;
      ciudad: string;
      anos_experiencia: number;
      modalidades: string[];
      idiomas_aviso: string[];
    };
  };
  casos: CarreraCaso[];
};

/** Persona de prueba tomada de `apps/web/e2e/personas/` (solo lo que usa el harness). */
export type PersonaDePrueba = {
  key: string;
  role: string;
  cefr: string;
  skills: { slug: string; level: 1 | 2 | 3 }[];
};

/** Categorías que llegan al modelo (el prefiltro no las descarta), en orden de preferencia. */
export const CATEGORIAS_POR_DEFECTO = [
  "nueve_mas",
  "remoto_otro_pais",
  "encaje_parcial",
  "presencial_caba",
] as const;

/** Elige 3 avisos por carrera: `nueve_mas`, `remoto_otro_pais` y el primero de encaje parcial o CABA. */
export function selectCases(doc: CarreraDoc, perCarrera = 3): CarreraCaso[] {
  const out: CarreraCaso[] = [];
  for (const cat of CATEGORIAS_POR_DEFECTO) {
    const c = doc.casos.find((x) => x.categoria === cat);
    if (c) out.push(c);
    if (out.length === perCarrera) break;
  }
  return out;
}

const LEVEL_TEXT: Record<1 | 2 | 3, string> = { 1: "básico", 2: "intermedio", 3: "avanzado" };

/**
 * Perfil de la persona para el prompt. El resumen se arma con el puesto y las skills de la persona de
 * prueba (no con su texto libre, que habla de otros años de experiencia); ubicación, años y
 * modalidades salen del golden, que es contra quien se escribieron los puntajes esperados.
 */
export function buildProfile(
  doc: CarreraDoc,
  persona: PersonaDePrueba,
  skillNames: Record<string, string>,
  roleLabel: string,
): ProfileForPrompt {
  const p = doc.meta.persona;
  const skills = persona.skills
    .map((s) => `${skillNames[s.slug] ?? s.slug} (${LEVEL_TEXT[s.level]})`)
    .join(", ");
  return {
    profileSummary: `Persona de prueba (ficticia) de ${roleLabel}, con ${p.anos_experiencia} años de experiencia. Skills declaradas: ${skills}.`,
    locationCountry: p.pais,
    locationCity: p.ciudad,
    remoteOnly: !p.modalidades.includes("presencial"),
    workAuth: { us: false, eu: false },
    englishCefr: persona.cefr,
    yearsTotal: p.anos_experiencia,
    targetRoleLabel: roleLabel,
  };
}

/** Lo que el golden llama `postular` es `aplicar` o `aplicar_personalizado` en `decide()`. */
export function actionFamily(accion: string): "postular" | "guardar" | "descartar" {
  if (accion === "aplicar" || accion === "aplicar_personalizado" || accion === "postular") {
    return "postular";
  }
  return accion === "guardar" ? "guardar" : "descartar";
}

export type CasoResultado = {
  carrera: string;
  id: string;
  categoria: string;
  titulo: string;
  persona: string;
  esperado: { min: number; max: number; accion: string };
  /** null si no se llamó al modelo (descartado por el prefiltro o falló la llamada). */
  score: number | null;
  scoreFinal: number | null;
  accion: string | null;
  /** Score del modelo dentro del rango esperado. */
  scoreEnRango: boolean | null;
  /** Score a menos de 1 punto del rango (métrica laxa). */
  scoreLaxo: boolean | null;
  accionCoincide: boolean | null;
  bloqueadores: string[];
  riesgos: string[];
  veredicto: string | null;
  costUsd: number | null;
  tokensIn: number | null;
  tokensOut: number | null;
  error: string | null;
  prefiltroDescarto: boolean;
};

export type CalidadDeps = {
  llm: LlmClient;
  rules: CriteriaRules;
  promptRef: string;
  skillNames: Record<string, string>;
  roleLabels: Record<string, string>;
  personas: Record<string, PersonaDePrueba>;
  /** carrera → clave de persona. */
  personaDeCarrera: Record<string, string>;
  /**
   * Tope duro: antes de cada llamada, lo gastado + una llamada esperada debe entrar en `maxUsd`. Sin
   * este tope no se llama (el CLI lo exige).
   */
  maxUsd: number;
  expectedCallUsd: number;
  signal?: AbortSignal;
};

export type CalidadSummary = {
  resultados: CasoResultado[];
  gastadoUsd: number;
  cortadoPorTope: boolean;
};

/** Un aviso: prefiltro de producción → modelo → `decide()`. */
export async function evaluarCaso(
  deps: CalidadDeps,
  doc: CarreraDoc,
  caso: CarreraCaso,
  profile: ProfileForPrompt,
  personaKey: string,
): Promise<CasoResultado> {
  const p = doc.meta.persona;
  const base: CasoResultado = {
    carrera: doc.meta.carrera,
    id: caso.id,
    categoria: caso.categoria,
    titulo: caso.titulo,
    persona: personaKey,
    esperado: { ...caso.etiquetas.score_esperado, accion: caso.etiquetas.accion_esperada },
    score: null,
    scoreFinal: null,
    accion: null,
    scoreEnRango: null,
    scoreLaxo: null,
    accionCoincide: null,
    bloqueadores: [],
    riesgos: [],
    veredicto: null,
    costUsd: null,
    tokensIn: null,
    tokensOut: null,
    error: null,
    prefiltroDescarto: false,
  };
  const pre = prefilter(
    {
      title: caso.titulo,
      companyRaw: caso.empresa,
      modality: caso.modalidad as PrefilterModality,
      locationRaw: caso.ubicacion_raw,
      jdText: caso.jd_text,
    },
    deps.rules,
    {
      targetRoles: [doc.meta.carrera],
      acceptedModalities: p.modalidades as PrefilterModality[],
      userCity: p.ciudad,
      userCountry: p.pais,
    } as Parameters<typeof prefilter>[2],
  );
  if (!pre.pass) {
    return {
      ...base,
      prefiltroDescarto: true,
      accion: "descartar",
      accionCoincide: actionFamily("descartar") === actionFamily(caso.etiquetas.accion_esperada),
      error: `prefiltro: ${pre.reason}`,
    };
  }

  const vars = buildEvaluateJobVars({
    profile,
    rules: deps.rules as unknown as Record<string, unknown>,
    job: {
      title: caso.titulo,
      companyRaw: caso.empresa,
      locationRaw: caso.ubicacion_raw,
      countriesAllowed: null,
      modality: caso.modalidad,
      jdText: caso.jd_text,
    },
    promptRef: deps.promptRef,
  });
  const r = await deps.llm.generateStructured(
    "evaluate_job",
    outputSchemaFor(deps.promptRef),
    vars,
    {
      promptVersion: deps.promptRef as never,
      wire: evaluationWireFor(deps.promptRef),
      signal: deps.signal,
      recordTask: "eval:carreras-r9",
    },
  );
  if (!r.ok) return { ...base, error: `${r.error.kind}: ${r.error.detail.slice(0, 200)}` };

  const ev = r.value.object;
  const d: Decision = decide(ev, deps.rules, {
    titleCap: pre.cap,
    prefilterFlags: pre.flags,
    candidateEnglishCefr: profile.englishCefr,
    candidateYearsTotal: profile.yearsTotal,
    candidateCountry: p.pais,
    acceptedModalities: p.modalidades as PrefilterModality[],
  });
  const { min, max } = caso.etiquetas.score_esperado;
  return {
    ...base,
    score: ev.score,
    scoreFinal: d.scoreFinal,
    accion: d.accion,
    scoreEnRango: ev.score >= min && ev.score <= max,
    scoreLaxo: ev.score >= min - 1 && ev.score <= max + 1,
    accionCoincide: actionFamily(d.accion) === actionFamily(caso.etiquetas.accion_esperada),
    bloqueadores: d.bloqueadores,
    riesgos: d.riesgos,
    veredicto: ev.veredicto ?? null,
    costUsd: r.value.costUsd,
    tokensIn: r.value.usage.inputTokens,
    tokensOut: r.value.usage.outputTokens,
  };
}

/** Corre todas las carreras, de a una llamada, con tope duro de gasto. */
export async function runCalidad(
  deps: CalidadDeps,
  docs: CarreraDoc[],
  perCarrera = 3,
  buildPersonaProfile: (doc: CarreraDoc, persona: PersonaDePrueba) => ProfileForPrompt,
): Promise<CalidadSummary> {
  const resultados: CasoResultado[] = [];
  let gastado = 0;
  let cortado = false;
  for (const doc of docs) {
    const key = deps.personaDeCarrera[doc.meta.carrera];
    const persona = key ? deps.personas[key] : undefined;
    if (!persona) throw new Error(`sin persona de prueba para ${doc.meta.carrera}`);
    const profile = buildPersonaProfile(doc, persona);
    for (const caso of selectCases(doc, perCarrera)) {
      if (cortado || deps.signal?.aborted) {
        cortado = true;
        break;
      }
      // Cada llamada se factura: el tope mira lo gastado + una llamada esperada
      if (gastado + deps.expectedCallUsd > deps.maxUsd + 1e-9) {
        cortado = true;
        break;
      }
      const res = await evaluarCaso(deps, doc, caso, profile, persona.key);
      gastado += res.costUsd ?? (res.prefiltroDescarto ? 0 : deps.expectedCallUsd);
      resultados.push(res);
    }
  }
  return { resultados, gastadoUsd: gastado, cortadoPorTope: cortado };
}

export type CarreraResumen = {
  carrera: string;
  casos: number;
  evaluados: number;
  scoreEnRango: number;
  scoreLaxo: number;
  accionCoincide: number;
  errores: number;
  costoUsd: number;
};

export function resumirPorCarrera(resultados: CasoResultado[]): CarreraResumen[] {
  const carreras = [...new Set(resultados.map((r) => r.carrera))];
  return carreras.map((carrera) => {
    const rs = resultados.filter((r) => r.carrera === carrera);
    const ev = rs.filter((r) => r.score !== null);
    return {
      carrera,
      casos: rs.length,
      evaluados: ev.length,
      scoreEnRango: ev.filter((r) => r.scoreEnRango).length,
      scoreLaxo: ev.filter((r) => r.scoreLaxo).length,
      accionCoincide: rs.filter((r) => r.accionCoincide).length,
      errores: rs.filter((r) => r.error !== null && !r.prefiltroDescarto).length,
      costoUsd: rs.reduce((a, r) => a + (r.costUsd ?? 0), 0),
    };
  });
}

/** Costo estimado de `calls` llamadas con la tarifa de la ruta (USD por millón de tokens). */
export function estimateUsd(
  calls: number,
  tokens: { in: number; out: number },
  price: { input: number; output: number },
): number {
  return (calls * (tokens.in * price.input + tokens.out * price.output)) / 1_000_000;
}

/** Tabla markdown del informe: por carrera y por aviso. Sin texto de los avisos. */
export function formatMarkdown(
  s: CalidadSummary,
  meta: { modelo: string; prompt: string },
): string {
  const pct = (n: number, d: number) => (d === 0 ? "n/a" : `${Math.round((n / d) * 100)}%`);
  const lines = [
    `Modelo: ${meta.modelo} · prompt ${meta.prompt} · ${s.resultados.length} avisos · USD ${s.gastadoUsd.toFixed(4)}${s.cortadoPorTope ? " · CORTADO por el tope" : ""}`,
    "",
    "| carrera | avisos | score en rango | score ±1 | acción coincide | errores | USD |",
    "|---|---|---|---|---|---|---|",
    ...resumirPorCarrera(s.resultados).map(
      (c) =>
        `| ${c.carrera} | ${c.casos} | ${c.scoreEnRango}/${c.evaluados} (${pct(c.scoreEnRango, c.evaluados)}) | ${c.scoreLaxo}/${c.evaluados} | ${c.accionCoincide}/${c.casos} (${pct(c.accionCoincide, c.casos)}) | ${c.errores} | ${c.costoUsd.toFixed(4)} |`,
    ),
    "",
    "| aviso | categoría | esperado | obtenido | acción esperada → obtenida | bloqueadores |",
    "|---|---|---|---|---|---|",
    ...s.resultados.map(
      (r) =>
        `| ${r.id} | ${r.categoria} | ${r.esperado.min}–${r.esperado.max} | ${r.score ?? "—"} (final ${r.scoreFinal ?? "—"}) | ${r.esperado.accion} → ${r.accion ?? "—"}${r.accionCoincide ? "" : " (NO)"} | ${r.bloqueadores.join("; ") || (r.error ?? "—")} |`,
    ),
  ];
  return lines.join("\n");
}
