import type { CriteriaRules } from "./criteria";
import type { Evaluation } from "./evaluation";
import { INJECTION_FLAG, INJECTION_RISK } from "./evaluator/injection";
import {
  IS_SALARY_TEXT,
  MIXED_TOPIC_TEXT,
  monthlySalaryUsd,
  salaryIsFromApi,
  salaryIsLocalCurrency,
  type JobFacts,
} from "./evaluator/job-facts";
import { inferSeniorityFromTitle } from "./normalize/seniority";
import { allowsCountry, locationScope, placesIn } from "./pool/location-scope";
import { RESIDENCY_FLAG } from "./prefilter/residency";
import { englishIsNotAGap } from "./skills/english-gap";

/**
 * Decisión desde score + bloqueadores + riesgos + umbrales (EVALUATOR_PROMPT §3, prompt v1.1).
 * El LLM sugiere; esto es lo que vale.
 *
 * | condición                                   | acción                 |
 * |---------------------------------------------|------------------------|
 * | bloqueadores_duros no vacío                 | descartar              |
 * | score < guardar                             | descartar              |
 * | riesgos + score ≥ aplicar                   | aplicar (UI muestra el riesgo) |
 * | riesgos + score entre guardar y aplicar     | guardar                |
 * | sin riesgos + score ≥ personalizado         | aplicar_personalizado  |
 * | sin riesgos + score ≥ aplicar               | aplicar                |
 * | sin riesgos + score entre guardar y aplicar | guardar                |
 * | location_ok = "no" (país excluido)          | tope: guardar como máximo, aunque el score sea alto |
 * | flag residencia_exigida:<países> (prefiltro) | bloqueador duro → descartar; location_ok efectivo = "no" |
 * | remoto limitado a un país que no es el de la persona (H-1) | bloqueador duro → descartar; location_ok efectivo = "no" |
 * | bloqueador de modalidad del modelo, modalidad aceptada | pasa a riesgos, no descarta (ronda 84) |
 */
export type ActionThresholds = { personalizado: number; aplicar: number; guardar: number };
export type Action = "aplicar_personalizado" | "aplicar" | "guardar" | "descartar";

export const DEFAULT_THRESHOLDS: ActionThresholds = { personalizado: 9, aplicar: 7, guardar: 5 };

export function decideAction(
  score: number,
  bloqueadoresDuros: readonly string[],
  thresholds: ActionThresholds = DEFAULT_THRESHOLDS,
  riesgos: readonly string[] = [],
): Action {
  if (bloqueadoresDuros.length > 0) return "descartar";
  if (score < thresholds.guardar) return "descartar";
  if (riesgos.length > 0) return score >= thresholds.aplicar ? "aplicar" : "guardar";
  if (score >= thresholds.personalizado) return "aplicar_personalizado";
  if (score >= thresholds.aplicar) return "aplicar";
  return "guardar";
}

/** País del candidato explícitamente excluido: nunca llega a "aplicar" sin que el humano lo vea. */
export function applyLocationCap(accion: Action, locationOk: string | null | undefined): Action {
  if (locationOk === "no" && (accion === "aplicar" || accion === "aplicar_personalizado")) {
    return "guardar";
  }
  return accion;
}

/** Contexto verificable con campos estructurados, fuera de lo que dijo el modelo. */
export type DecideContext = {
  /** Cap del prefiltro (título en blocklist con excepción) o null. */
  titleCap?: number | null;
  /** Flags del prefiltro (location_risk, many_candidates...) que se suman a los riesgos. */
  prefilterFlags?: readonly string[];
  /** CEFR del candidato (profiles.english_cefr). Sin esto no se evalúa el riesgo de inglés. */
  candidateEnglishCefr?: string | null;
  /** Años del candidato (profiles.years_total). Sin esto no se evalúa el gap de años. */
  candidateYearsTotal?: number | null;
  /**
   * Modalidades que acepta la persona (`effectiveAcceptedModalities`). Ausente = no hay con qué
   * contradecir al modelo: sus bloqueadores de modalidad se respetan (comportamiento previo).
   */
  acceptedModalities?: readonly ("remoto" | "hibrido" | "presencial")[];
  /**
   * Hechos estructurados del aviso (`jobs.*`): el código decide con esto antes que con el texto del
   * modelo (salario, jornada, seniority del título, idioma del aviso). Ausente = todo como antes.
   */
  jobFacts?: JobFacts;
  /** País de la persona (ISO-2, `profiles.location_country`). Sin esto no se evalúa la regla de país. */
  candidateCountry?: string | null;
  /**
   * Dónde dice el aviso que se puede trabajar. Con `candidateCountry`, un aviso remoto limitado a
   * otros países es bloqueador (H-1). Ausente = todo como antes.
   */
  jobLocation?: JobLocation;
};

/** Datos de ubicación del aviso que usa la regla de país (todo opcional: lo que falta falla abierto). */
export type JobLocation = {
  modality?: string | null;
  locationRaw?: string | null;
  countriesAllowed?: readonly string[] | null;
  jdText?: string | null;
};

export type Adjustment = { rule: string; delta: number; detail: string };

export type Decision = {
  /** Score del modelo (match puro). */
  scoreModel: number;
  /** Score tras cap y penalizaciones verificables. Es el que se compara con los umbrales. */
  scoreFinal: number;
  bloqueadores: string[];
  riesgos: string[];
  /**
   * Subconjunto de `riesgos` que el código agregó solo para informar (rango salarial bajo el piso,
   * moneda local, seniority del título). Se muestran igual, pero no bajan la acción a «aplicar».
   */
  riesgosInformativos: string[];
  adjustments: Adjustment[];
  accion: Action;
  /** `location_ok` efectivo: el del modelo, salvo que el código vea residencia exigida ("no"). */
  locationOk: Evaluation["location_ok"];
};

const CLOUD = /\b(aws|azure|gcp|google cloud|kubernetes|k8s|eks|terraform)\b/i;
const FLAG_TO_RISK: Record<string, { text: string; already: RegExp }> = {
  location_risk: {
    text: "ubicación con riesgo (país del candidato no listado o LATAM/remote sin países)",
    already: /pa[ií]s|latam|ubicaci/i,
  },
  many_candidates: { text: "muchos candidatos", already: /candidatos/i },
  modalidad_no_remota: {
    text: "modalidad híbrida o presencial",
    already: /h[ií]brid|presencial|modalidad|oficina|on-?site/i,
  },
  ciudad_distinta: {
    text: "La oferta parece ser en otra ciudad que la de tu perfil",
    already: /otra ciudad|ciudad distinta/i,
  },
};

/** Nombre del ajuste (sin delta) y prefijo del bloqueador de la regla de país (H-1). */
export const COUNTRY_ONLY_RULE = "pais_excluido";
export const COUNTRY_ONLY_BLOCKER = "aviso limitado a";

/** Menciones de huso u horario: no son lugares, se sacan antes de leer qué lugares nombra una frase. */
const TZ_WORDS =
  /\b(?:time ?zones?|tz|hours|overlap(?:ping)?|est|edt|pst|pdt|cst|cdt|mst|mdt|gmt|utc)\b/gi;
const MAX_LOCATION_TEXT = 20_000;

/** ¿Alguna frase del texto nombra el país de la persona o una región que lo incluye? */
function textAcceptsCountry(text: string | null | undefined, country: string): boolean {
  if (!text) return false;
  for (const sentence of text.slice(0, MAX_LOCATION_TEXT).split(/[.\n;!?]+/)) {
    const places = placesIn(sentence.replace(TZ_WORDS, " "));
    if (places && allowsCountry({ kind: "places", ...places }, country)) return true;
  }
  return false;
}

/**
 * Regla de país (H-1): un aviso REMOTO limitado a países entre los que no está el de la persona.
 * Devuelve los lugares a los que se limita, o `null`. Falla abierto ante cualquier duda: sin país de
 * la persona, modalidad no remota, ubicación que no se entiende, o un texto del aviso (ubicación o
 * JD) que nombra su país o una región que lo incluye ("LATAM", "worldwide") → no bloquea.
 */
export function countryOnlyPlaces(
  candidateCountry: string | null | undefined,
  job: JobLocation | undefined,
): string | null {
  const country = candidateCountry?.trim().toUpperCase();
  if (!country || !job || job.modality !== "remoto") return null;
  const scope = locationScope(job.locationRaw, job.countriesAllowed);
  if (scope.kind !== "places" || allowsCountry(scope, country)) return null;
  if (textAcceptsCountry(job.locationRaw, country) || textAcceptsCountry(job.jdText, country)) {
    return null;
  }
  return [...scope.countries, ...scope.regions].join(", ");
}

const RANGE_RISK = "el rango salarial empieza abajo de tu piso";
const LOCAL_RISK = "salario en USD pagado en moneda local";
const ENGLISH_MOOT_RISK = "el modelo marcó inglés, pero el aviso parece no pedirlo";

const clamp = (n: number) => Math.max(0, Math.min(10, n));

/**
 * Las reglas de JS-052 viven en evaluation_criteria.rules, que se actualiza aparte del deploy.
 * Si el código sale primero, la lista no existe todavía: la regla queda apagada en vez de tirar
 * el worker abajo. Una lista vacía es configuración inválida, no "todo bloquea".
 */
const disciplinasPermitidas = (rules: CriteriaRules): string[] | null => {
  const lista = rules.allowed_disciplines;
  return Array.isArray(lista) && lista.length > 0 ? lista : null;
};

/** Un bloqueador de disciplina, lo escriba el modelo o el código. */
const IS_DISCIPLINE_BLOCKER = /disciplina distinta/i;
/**
 * Un bloqueador de modalidad del modelo. "modalidad" sola no cuenta ("modalidad de contratación"):
 * tiene que ir con una palabra de modalidad. Sin "relocat": mudarse de país no es modalidad.
 */
const IS_MODALITY_BLOCKER =
  /presencial|h[ií]brid|oficina|on-?site|modalidad\b.*\b(?:remot|presencial|h[ií]brid|oficina|on-?site)/i;
/**
 * Si el texto también habla de otra cosa (jornada, años, salario, visa, contrato, idioma, una
 * entrevista presencial, una nube híbrida, un paquete office) o de otro país, no se toca: lo conservador. "visitas" solo
 * cuenta junto a oficina o presencial (que ya matchean solas): sin eso puede ser un viaje.
 */
const MIXED_BLOCKER =
  /jornada|horas|a[ñn]os|years|salari|visa|autoriz|residen|residir|radic|reubic|\bmud|permiso|ciudadan|sponsor|work permit|relocat|contrat|freelance|monotribut|dependencia|ingl|english|disciplina|entrevista|nube|cloud|infraestructura|paquete|otro pa[ií]s|fuera de|exterior|abroad|outside/i;
/** Modalidades concretas que nombra un bloqueador; "oficina", "on-site" o "visitas" no nombran ninguna. */
const namedModalities = (b: string): ("hibrido" | "presencial")[] => [
  ...(/h[ií]brid/i.test(b) ? (["hibrido"] as const) : []),
  ...(/presencial/i.test(b) ? (["presencial"] as const) : []),
];
const normalizeText = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/**
 * Escala del inglés exigido por el aviso. `no_menciona` y `no` quedan fuera: no hay nivel que
 * comparar. El CEFR del candidato se traduce a la misma escala para poder compararlos.
 */
const ENGLISH_RANK: Record<string, number> = { basico: 1, intermedio: 2, avanzado: 3, nativo: 4 };
const CEFR_RANK: Record<string, number> = {
  a1: 1,
  a2: 1,
  b1: 2,
  b2: 2,
  c1: 3,
  c2: 4,
};

/** B1 → 2 (intermedio). Toma el primer nivel de un "B1-B2" y devuelve null si no se entiende. */
export function englishRankFromCefr(cefr: string | null | undefined): number | null {
  const m = /([abc][12])/i.exec(cefr ?? "");
  return m ? (CEFR_RANK[m[1]!.toLowerCase()] ?? null) : null;
}

/**
 * decide(): aplica en código lo que se puede verificar con campos estructurados y recalcula
 * la acción. El modelo propone score y listas; acá se corrige lo que no aplicó:
 * - cap de título (prefiltro): el score no supera el cap;
 * - años requeridos ≥ max_years_hard → bloqueador aunque el modelo no lo haya puesto;
 * - años en el rango de penalización (5–7) → −years_penalty;
 * - gap must de cloud/infra → −cloud_must_penalty;
 * - inglés requerido avanzado/nativo → −english_fluent_penalty, solo si el CEFR del candidato está
 *   por debajo de lo requerido o no se conoce;
 * - flags del prefiltro (location_risk, many_candidates, modalidad_no_remota) y location_ok ≠ ok → riesgos, sin duplicar.
 */
export function decide(
  evaluation: Evaluation,
  rules: CriteriaRules,
  context: DecideContext = {},
): Decision {
  const adjustments: Adjustment[] = [];
  const bloqueadores = [...evaluation.bloqueadores_duros];
  const riesgos = [...evaluation.riesgos];
  let score = evaluation.score;

  if (context.titleCap !== null && context.titleCap !== undefined && score > context.titleCap) {
    adjustments.push({
      rule: "title_cap",
      delta: context.titleCap - score,
      detail: `cap de título ${context.titleCap}`,
    });
    score = context.titleCap;
  }

  const years = evaluation.years_required;
  if (years !== null && years >= rules.max_years_hard) {
    if (!bloqueadores.some((b) => /a[ñn]os|years/i.test(b))) {
      bloqueadores.push(`años requeridos ≥ ${rules.max_years_hard} (${years})`);
    }
  } else if (
    years !== null &&
    years >= rules.years_penalty.from &&
    years <= rules.years_penalty.to
  ) {
    adjustments.push({
      rule: "years_penalty",
      delta: -rules.years_penalty.penalty,
      detail: `${years} años requeridos (${rules.years_penalty.from}–${rules.years_penalty.to})`,
    });
    score -= rules.years_penalty.penalty;
  }

  /**
   * Años de otra disciplina (JS-052, prompt v1.3.2+). "2-3 years in advertising creative
   * development" no son 2 años de experiencia que el candidato tenga: son de otro oficio. El
   * modelo extrae el dominio y la disciplina; acá se decide si el candidato puede tenerlos.
   */
  const permitidas = disciplinasPermitidas(rules);
  const yearsDiscipline = evaluation.years_discipline;
  if (
    permitidas !== null &&
    yearsDiscipline !== null &&
    !permitidas.includes(yearsDiscipline) &&
    !bloqueadores.some((b) => /otro dominio/i.test(b))
  ) {
    bloqueadores.push(`años en otro dominio (${evaluation.years_domain ?? yearsDiscipline})`);
  }

  /**
   * Gap de años contra el perfil (JS-052). Las reglas de arriba son absolutas y siguen mandando;
   * esto solo agrega contexto verificable ("pide 5, tenés 3"). Por defecto es riesgo y nada más:
   * penalizar o bloquear por gap contradecía la referencia humana del golden (ids 6, 7, 30, 34).
   * Si ya hay bloqueador de años, el riesgo sobra.
   */
  const gapRules = rules.years_gap;
  const candidateYears = context.candidateYearsTotal;
  if (
    gapRules &&
    years !== null &&
    candidateYears !== null &&
    candidateYears !== undefined &&
    !bloqueadores.some((b) => /a[ñn]os|years/i.test(b))
  ) {
    const gap = years - candidateYears;
    const alcanza = (from: number | null) => from !== null && gap >= from;
    if (alcanza(gapRules.blocker_from)) {
      bloqueadores.push(`gap de años: pide ${years}, el candidato tiene ${candidateYears}`);
    } else if (alcanza(gapRules.penalty_from) && gapRules.penalty) {
      adjustments.push({
        rule: "years_gap_penalty",
        delta: -gapRules.penalty,
        detail: `gap de ${gap} años (pide ${years}, tiene ${candidateYears})`,
      });
      score -= gapRules.penalty;
    } else if (alcanza(gapRules.risk_from) && !riesgos.some((r) => /a[ñn]os|years/i.test(r))) {
      riesgos.push(`pide ${years} años, tenés ${candidateYears}`);
    }
  }

  /**
   * Disciplina (JS-052). El prompt la clasifica, pero hasta v1.3.1 también escribía el bloqueador
   * a mano y se lo salteaba (Empresa V, golden id 35) o lo inventaba sobre algo que no es disciplina
   * (una oferta en produccion: "disciplina distinta (lead)"). Acá manda el campo tipado contra las disciplinas del
   * perfil: si no está permitida, bloqueador y tope de score; si está permitida, un bloqueador de
   * disciplina del modelo es una contradicción y se cae.
   */
  const disciplinaPermitida = permitidas === null || permitidas.includes(evaluation.disciplina);
  if (!disciplinaPermitida) {
    if (!bloqueadores.some((b) => IS_DISCIPLINE_BLOCKER.test(b))) {
      bloqueadores.push(`disciplina distinta (${evaluation.disciplina})`);
    }
    if (rules.discipline_cap_score !== undefined && score > rules.discipline_cap_score) {
      adjustments.push({
        rule: "discipline_cap",
        delta: rules.discipline_cap_score - score,
        detail: `disciplina ${evaluation.disciplina} fuera del perfil (tope ${rules.discipline_cap_score})`,
      });
      score = rules.discipline_cap_score;
    }
  } else if (permitidas !== null) {
    // Sin lista configurada no hay con qué contradecir al modelo: se respeta lo que dijo.
    for (let i = bloqueadores.length - 1; i >= 0; i--) {
      if (IS_DISCIPLINE_BLOCKER.test(bloqueadores[i]!)) bloqueadores.splice(i, 1);
    }
  }

  /**
   * Modalidad (ronda 84). El prefiltro ya descartó lo que la persona no acepta; acá un bloqueador
   * de modalidad del modelo sobre una modalidad ACEPTADA pasa a riesgo. "remoto"/"desconocida" con
   * bloqueador de modalidad ("primera semana en oficina") es una señal sin tipo: como en el
   * prefiltro, vale si acepta híbrido o presencial.
   */
  const aceptadas = context.acceptedModalities;
  if (aceptadas) {
    const m = evaluation.modalidad;
    // Sin modalidad concreta en el texto vale la del aviso (o la señal sin tipo, si acepta no remoto).
    const sinTipo =
      m === "hibrido" || m === "presencial"
        ? aceptadas.includes(m)
        : aceptadas.some((a) => a !== "remoto");
    for (let i = bloqueadores.length - 1; i >= 0; i--) {
      const b = bloqueadores[i]!;
      if (!IS_MODALITY_BLOCKER.test(b) || MIXED_BLOCKER.test(b)) continue;
      const nombradas = namedModalities(b);
      const aceptada = nombradas.length ? nombradas.every((n) => aceptadas.includes(n)) : sinTipo;
      if (!aceptada) continue;
      bloqueadores.splice(i, 1);
      if (!riesgos.some((r) => normalizeText(r) === normalizeText(b))) riesgos.push(b);
    }
  }

  const facts = context.jobFacts;
  /** Riesgos que agrega el código y que solo informan: se muestran pero no bajan «aplicar personalizado». */
  const informativos: string[] = [];

  /**
   * Salario (D3, ronda 104). Con salario estructurado mensual o anual en USD manda el dato: máximo
   * por debajo del piso → bloqueador; piso dentro del rango → riesgo; máximo ≥ piso → el bloqueador
   * de salario del modelo es una contradicción y se cae. Por hora, otro período o sin cifras: no se
   * sabe y vale lo que dijo el modelo. Moneda local en la nota: si el máximo en USD ya está bajo el
   * piso, bloquea igual (la nota no lo salva); si no, la moneda local es solo riesgo.
   */
  const floor = rules.salary_floor_usd_monthly;
  // Salario leído del texto del aviso (S-O4): lo controla un tercero; no bloquea ni desmiente al modelo
  const salary = salaryIsFromApi(facts) ? monthlySalaryUsd(facts) : null;
  if (typeof floor === "number" && floor > 0 && salary && salary.max !== null) {
    if (salary.max < floor) {
      if (!bloqueadores.some((b) => IS_SALARY_TEXT.test(b))) {
        bloqueadores.push(
          `salario publicado por debajo del piso (USD ${salary.max}/mes < ${floor})`,
        );
      }
    } else {
      for (let i = bloqueadores.length - 1; i >= 0; i--) {
        const b = bloqueadores[i]!;
        if (IS_SALARY_TEXT.test(b) && !MIXED_TOPIC_TEXT.test(b)) bloqueadores.splice(i, 1);
      }
      if (salary.min !== null && salary.min < floor && !riesgos.includes(RANGE_RISK)) {
        riesgos.push(RANGE_RISK);
        informativos.push(RANGE_RISK);
      }
    }
  }
  if (salaryIsLocalCurrency(facts)) {
    if (!riesgos.some((r) => /moneda local|pesos|\bars\b/i.test(r))) {
      riesgos.push(LOCAL_RISK);
      informativos.push(LOCAL_RISK);
    }
  }

  /** Jornada: la fuente trae horas semanales y superan el máximo del perfil. Sin dato vale el modelo. */
  const maxHours = rules.max_weekly_hours;
  const hours = facts?.weeklyHours;
  if (
    typeof maxHours === "number" &&
    maxHours > 0 &&
    typeof hours === "number" &&
    hours > maxHours &&
    !bloqueadores.some((b) => /jornada|horas/i.test(b))
  ) {
    bloqueadores.push(`jornada de ${hours} h (máximo ${maxHours})`);
  }

  /**
   * Seniority del título (D6): solo riesgo, nunca bloqueador ni score. "Lead" ya lo trata el
   * prefiltro (blocklist y cap): no se duplica.
   */
  const titleLevels = facts?.title
    ? (inferSeniorityFromTitle(facts.title)?.split(" / ") ?? [])
    : [];
  const yearsNow = context.candidateYearsTotal;
  if (titleLevels.length && yearsNow !== null && yearsNow !== undefined) {
    const juniorOnly = titleLevels.every((l) => l === "Trainee" || l === "Junior");
    const seniorOnly = titleLevels.every((l) => l === "Senior");
    const risk =
      juniorOnly && yearsNow >= 4
        ? `el aviso es junior y tenés ~${yearsNow} años: pueden descartarte por sobrecalificado o pagar menos`
        : seniorOnly && yearsNow < 3
          ? `el aviso es senior y tenés ~${yearsNow} años`
          : null;
    if (risk && !riesgos.includes(risk)) {
      riesgos.push(risk);
      informativos.push(risk);
    }
  }

  /**
   * Inglés en un aviso en español que no lo pide (ronda 101): el modelo a veces exige inglés por
   * costumbre. Si el texto está en español y no pide inglés, ni la penalización ni el riesgo de
   * inglés valen. Un aviso puede esconder el pedido (S-O3, ronda 109), así que un BLOQUEADOR de
   * inglés del modelo no se borra: pasa a riesgo. Los riesgos de inglés sí se sacan.
   */
  const englishMoot = englishIsNotAGap(facts?.jdText ?? null, null);
  if (englishMoot) {
    const isPureEnglish = (t: string) =>
      /ingl[eé]s|english/i.test(t) && !MIXED_TOPIC_TEXT.test(t.replace(/ingl[eé]s|english/gi, ""));
    let demoted = false;
    for (let i = bloqueadores.length - 1; i >= 0; i--) {
      if (!isPureEnglish(bloqueadores[i]!)) continue;
      bloqueadores.splice(i, 1);
      demoted = true;
    }
    for (let i = riesgos.length - 1; i >= 0; i--) {
      if (isPureEnglish(riesgos[i]!)) riesgos.splice(i, 1);
    }
    if (demoted && !riesgos.includes(ENGLISH_MOOT_RISK)) riesgos.push(ENGLISH_MOOT_RISK);
  }

  const cloudMust = evaluation.gaps.find((g) => g.nivel === "must" && CLOUD.test(g.skill));
  if (cloudMust && rules.cloud_must_penalty) {
    adjustments.push({
      rule: "cloud_must_penalty",
      delta: -rules.cloud_must_penalty,
      detail: `must de infraestructura: ${cloudMust.skill}`,
    });
    score -= rules.cloud_must_penalty;
  }

  // Se penaliza solo si el CEFR de la persona está por debajo de lo requerido; sin CEFR
  // (o ilegible) se penaliza como siempre, lo conservador.
  const requeridoRank = ENGLISH_RANK[evaluation.ingles_requerido];
  const candidatoRank = englishRankFromCefr(context.candidateEnglishCefr);
  if (
    !englishMoot &&
    (evaluation.ingles_requerido === "avanzado" || evaluation.ingles_requerido === "nativo") &&
    rules.english_fluent_penalty &&
    (candidatoRank === null || (requeridoRank !== undefined && candidatoRank < requeridoRank))
  ) {
    adjustments.push({
      rule: "english_fluent_penalty",
      delta: -rules.english_fluent_penalty,
      detail: `inglés requerido ${evaluation.ingles_requerido}`,
    });
    score -= rules.english_fluent_penalty;
  }

  /**
   * Inglés exigido por encima del candidato: RIESGO, nunca bloqueador (el candidato aplica igual).
   * La penalización de score (english_fluent_penalty) es otra cosa y sigue corriendo arriba.
   */
  const requerido = ENGLISH_RANK[evaluation.ingles_requerido];
  const candidato = englishRankFromCefr(context.candidateEnglishCefr);
  const desde = ENGLISH_RANK[rules.english_risk_from];
  if (
    !englishMoot &&
    requerido !== undefined &&
    candidato !== null &&
    desde !== undefined &&
    requerido >= desde &&
    requerido > candidato &&
    !riesgos.some((r) => /ingl[eé]s|english/i.test(r))
  ) {
    riesgos.push(
      `inglés requerido ${evaluation.ingles_requerido}, el candidato tiene ${context.candidateEnglishCefr}`,
    );
  }

  for (const flag of context.prefilterFlags ?? []) {
    const risk = FLAG_TO_RISK[flag];
    if (risk && !riesgos.some((r) => risk.already.test(r))) riesgos.push(risk.text);
  }
  if (evaluation.location_ok !== "ok" && !riesgos.some((r) => /pa[ií]s|latam|ubicaci/i.test(r))) {
    riesgos.push(`location_ok = ${evaluation.location_ok}`);
  }

  /**
   * Residencia exigida en un país ajeno (ronda 66): el aviso dice "must be based in Canada" y la
   * persona no vive ahí. El prefiltro lo detecta con una frase literal; acá es bloqueador duro y
   * el `location_ok` efectivo pasa a "no", aunque el modelo haya dicho "ok" o "riesgo".
   * Es una regla determinista sobre texto de terceros que SÍ descarta, a pedido (H-1); por eso el
   * detector falla abierto ante cualquier duda (ver prefilter/residency.ts).
   */
  const residencyFlag = (context.prefilterFlags ?? []).find((f) =>
    f.startsWith(`${RESIDENCY_FLAG}:`),
  );
  let locationOk: Evaluation["location_ok"] = evaluation.location_ok;
  if (residencyFlag) {
    const places = residencyFlag
      .slice(RESIDENCY_FLAG.length + 1)
      .split(",")
      .join(", ");
    if (!bloqueadores.some((b) => /pa[ií]s|residen|ubicaci/i.test(b))) {
      bloqueadores.push(`residencia exigida en ${places}`);
    }
    adjustments.push({
      rule: "residencia_exigida",
      delta: 0,
      detail: `el aviso exige residir en ${places}`,
    });
    locationOk = "no";
  }

  /**
   * Aviso remoto limitado a otro país (H-1): "Remote (Canada)", lista de países sin el de la
   * persona. Es bloqueador y no solo riesgo, salvo que el aviso diga que acepta su país o su región
   * (`countryOnlyPlaces` falla abierto). Va después de la residencia exigida, que ya cubre el caso
   * de la frase literal, para no duplicar el bloqueador.
   */
  const onlyPlaces = countryOnlyPlaces(context.candidateCountry, context.jobLocation);
  if (onlyPlaces && !residencyFlag) {
    if (!bloqueadores.some((b) => /pa[ií]s|residen|ubicaci/i.test(b))) {
      bloqueadores.push(`${COUNTRY_ONLY_BLOCKER} ${onlyPlaces} (no incluye tu país)`);
    }
    adjustments.push({
      rule: COUNTRY_ONLY_RULE,
      delta: 0,
      detail: `el aviso remoto se limita a ${onlyPlaces}`,
    });
    locationOk = "no";
  }

  /**
   * Aviso con instrucciones dirigidas al evaluador (ronda 43). El texto es de terceros: si intentó
   * mover el score, no lo logra más allá de "guardar" y la persona ve el riesgo. Nunca descarta.
   */
  const injected = (context.prefilterFlags ?? []).includes(INJECTION_FLAG);
  if (injected) {
    if (!riesgos.includes(INJECTION_RISK)) riesgos.push(INJECTION_RISK);
    if (score > rules.thresholds.guardar) {
      adjustments.push({
        rule: "injection_cap",
        delta: rules.thresholds.guardar - score,
        detail: `aviso con instrucciones al evaluador (tope ${rules.thresholds.guardar})`,
      });
      score = rules.thresholds.guardar;
    }
  }

  const scoreFinal = clamp(score);
  let accion = applyLocationCap(
    decideAction(
      scoreFinal,
      bloqueadores,
      rules.thresholds,
      riesgos.filter((r) => !informativos.includes(r)),
    ),
    locationOk,
  );
  if (injected && (accion === "aplicar" || accion === "aplicar_personalizado")) accion = "guardar";
  return {
    scoreModel: evaluation.score,
    scoreFinal,
    bloqueadores,
    riesgos,
    riesgosInformativos: informativos.filter((r) => riesgos.includes(r)),
    adjustments,
    accion,
    locationOk,
  };
}
