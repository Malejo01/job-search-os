import type { CriteriaRules } from "../criteria";
import { countriesMentioned, countryNames } from "../normalize/location";
import { foldText } from "../normalize/text";

/**
 * Prefiltro determinista, sin LLM, con SOLO los campos que trae un email de alerta
 * (título, empresa, ubicación, modalidad, badges, candidatos). Descarta únicamente por
 * bloqueadores duros (modalidad no remota, disciplina distinta) y por las reglas de título y
 * badge de CriteriaRules. Los riesgos (país no listado, LATAM sin países, muchos candidatos)
 * NUNCA descartan: se devuelven como flags para la UI y el evaluador.
 */
export type PrefilterInput = {
  title: string;
  companyRaw?: string | null;
  locationRaw?: string | null;
  modality?: "remoto" | "hibrido" | "presencial" | "desconocida" | null;
  badges?: readonly string[] | null;
  candidatesCount?: number | null;
  /** 0..1 si ya viene calculado; si no, se deriva del badge "X de Y aptitudes". */
  skillsMatchRatio?: number | null;
  /** Países del aviso si la fuente los trae estructurados (Get on Board). */
  countriesAllowed?: readonly string[] | null;
};

export type PrefilterReason =
  "modalidad_no_remota" | "disciplina_distinta" | "badge_aptitudes" | "titulo_blocklist";

export type PrefilterResult =
  | { pass: true; cap: number | null; flags: string[] }
  | { pass: false; reason: PrefilterReason; detail: string };

export type PrefilterOptions = {
  /**
   * País del candidato (ISO-2). Ausente = AR, como siempre (evals/ llama sin país). `null` = país
   * desconocido: toda oferta con restricción de ubicación queda con `location_risk`.
   */
  userCountry?: string | null;
  manyCandidatesFrom?: number;
};

const NON_REMOTE_IN_TEXT = /\b(hibrid[oa]|hybrid|presencial|on[\s-]?site|in[\s-]?office)\b/;

/**
 * Modalidad no remota en el TÍTULO. Criterio contra falsos positivos ("Hybrid Cloud Engineer",
 * "Sistemas Híbridos de IA", "hybrid apps"): la señal cuenta solo si es un SEGMENTO propio del
 * título, es decir separada del resto por un delimitador (paréntesis, corchetes, guion, coma,
 * barra, pipe, dos puntos) o por el borde del título, y el segmento no tiene más palabras que la
 * señal y un par de calificadores ("Hybrid work", "Modalidad híbrida", "Hybrid 3 days").
 * Sin lista de compuestos técnicos: un sustantivo del rol queda siempre pegado a otras palabras.
 * Costo aceptado: "Hybrid Backend Engineer" (sin delimitador) no descarta; lo ve el evaluador.
 * "Optional/opcional/flexible" pegado a la señal (aun a través de un delimitador) la anula.
 */
const TITLE_NON_REMOTE_SEGMENT =
  /^(?:(?:modalidad|modelo|esquema|work|working)\s+)?(?:hibrid[oa]|hybrid|presencial|onsite|inoffice|en\s+oficina)(?:\s+(?:work|working|mode|model|modelo|modalidad))?(?:\s+\d.*)?$/;
// Señales que nunca son sustantivo del rol: pueden abrir un segmento con palabras después
// ("Presencial en Madrid", "Híbrido CABA"). "hibridos/as" (plural) es el sustantivo; "onsite
// interview(s)" es el proceso de selección. El inglés "hybrid" no entra: "Hybrid Cloud".
const TITLE_STRONG_SEGMENT_START =
  /^(?:(?:modalidad|modelo|esquema)\s+)?(?:hibrid[oa]|presencial|onsite|inoffice|en\s+oficina)(?:\s|$)(?!interviews?\b)/;
const NON_REMOTE_SIGNAL = "hibrid[oa]|hybrid|presencial|onsite|inoffice";
// "flexible hours/schedule/horario" es horario, no modalidad: no anula la señal.
const NON_REMOTE_OPTIONAL = new RegExp(
  `\\b(?:(?:${NON_REMOTE_SIGNAL})\\W+(?:optional|opcional|flexible(?!\\s+(?:hours|schedule|horarios?)\\b))|(?:optional|opcional|flexible)\\W+(?:${NON_REMOTE_SIGNAL}))\\b`,
);

function titleNonRemoteSignal(foldedTitle: string): string | null {
  const text = foldedTitle
    .replace(/\bon[\s-]site\b/g, "onsite")
    .replace(/\bin[\s-]office\b/g, "inoffice");
  if (NON_REMOTE_OPTIONAL.test(text)) return null;
  // El guion solo delimita con espacios alrededor: "Hybrid-Cloud", "Non-hybrid" no se parten.
  for (const raw of text.split(/[()[\],/|:;–—]+|(?:^|\s)-(?:\s|$)/)) {
    const seg = raw.replace(/\s+/g, " ").trim();
    if (seg && (TITLE_NON_REMOTE_SEGMENT.test(seg) || TITLE_STRONG_SEGMENT_START.test(seg)))
      return seg;
  }
  return null;
}

const AI_TITLE =
  /\b(ai|ia|llm|llms|gen\s?ai|genai|agentic|agents?|agente|inteligencia artificial)\b/;

// Sufijo de género/plural en títulos en español: "administrativo/a", "vendedor(a)", "administrativ@".
// Sobre texto ya pasado por foldText; "/a" y "(a)" quedan como separador y el "a" suelto matchea.
const GENDER = "(?:[oa]s?|@)?";
const word = (body: string) => new RegExp(`(?<![a-z0-9])${body}(?![a-z0-9])`);

/**
 * Títulos de otros oficios (lista conservadora, a propósito en código y no en CriteriaRules:
 * las reglas de la base las cambia el dueño de la instancia con un UPDATE y esto tiene que andar sin tocar la base).
 * `label` es lo que se muestra en el detail.
 */
const NON_IT_TITLE: readonly { label: string; re: RegExp }[] = [
  { label: "administrativ", re: word(`administrativ${GENDER}`) },
  { label: "auxiliar contable", re: word("auxiliar\\s+contables?") },
  { label: "recepcionista", re: word("recepcionistas?") },
  { label: "cajer", re: word(`cajer${GENDER}`) },
  { label: "vendedor", re: word("vendedor(?:es|as?|@)?") },
  { label: "atencion al cliente", re: word("atencion\\s+al\\s+cliente") },
  { label: "call center", re: word("call\\s?center") },
  { label: "operari", re: word(`operari${GENDER}`) },
  { label: "repositor", re: word("repositor(?:es|as?|@)?") },
  { label: "chofer", re: word("chofer(?:es)?") },
  { label: "moz", re: word(`moz${GENDER}`) },
  { label: "abogad", re: word(`abogad${GENDER}`) },
];

/**
 * Bases genéricas de RR. HH. ("cargá tu CV", "talent pool"): no son un aviso. Descartan SIEMPRE,
 * aunque el título mencione IT ("Cargá tu CV — perfiles IT"): no entran en la excepción IT_SIGNAL.
 */
const HR_POOL_TITLE: readonly { label: string; re: RegExp }[] = [
  {
    label: "base de CV",
    re: word(
      "(?:carga|cargue|deja|dejanos|envia|envianos|manda|mandanos|subi|ingresa|ingrese|registra|registrate|sumate)\\s+(?:tu|su)\\s+(?:cv|curriculum)",
    ),
  },
  { label: "base de talentos", re: word("(?:base|banco)\\s+de\\s+(?:talentos|cvs?|curriculums?)") },
  {
    label: "base general",
    re: word("base\\s+general(?:\\s+de\\s+(?:cv|talentos|postulantes))?"),
  },
  { label: "talent pool", re: word("talent\\s+pool") },
  { label: "búsquedas generales", re: word("busquedas?\\s+generales") },
  { label: "postulación espontánea", re: word("postulacion(?:es)?\\s+espontanea") },
];

/**
 * Señal IT en el título: si está, un título de otro oficio no descarta ("Desarrollador/a Full
 * Stack para área administrativa"). "informático/a" solo NO es señal: sí lo es "analista/técnico
 * informático".
 */
const IT_SIGNAL_WORDS = word(
  "(?:developers?|desarrollador(?:es|as?)?|programador(?:es|as?)?|engineers?|ingenier[oa]s?\\s+de\\s+(?:software|datos)|software|data|datos|devops|sre|qa|testers?|full\\s?-?stack|front\\s?-?end|back\\s?-?end|sysadmin|sistemas|help\\s?desk|soporte\\s+tecnico|redes|cloud|ciberseguridad|(?:soporte|analista|tecnico|area|equipo)\\s+(?:de\\s+)?it|analista\\s+funcional|analista\\s+programador(?:es|as?)?|(?:tecnic[oa]|analista)\\s+informatic[oa])",
);
const hasItSignal = (title: string) => IT_SIGNAL_WORDS.test(title) || AI_TITLE.test(title);
const REMOTE_NO_COUNTRY = /\b(latam|latinoam[eé]rica|remote|remoto|anywhere)\b/;
const ANYWHERE = /\b(anywhere|worldwide|global)\b/;
const FOREIGN_REGION =
  /\b(us|usa|u\.s\.a?\.?|ee\.?\s?uu\.?|united states|estados unidos|canada|north america|norteamerica|americas|emea|apac|europe|europa)(?![a-z0-9])/;

/** "3 de 4 aptitudes coinciden" → 0.75; sin badge de aptitudes → null. */
export function skillsMatchRatioFromBadges(
  badges: readonly string[] | null | undefined,
): number | null {
  for (const b of badges ?? []) {
    const m = /(\d+)\s+de\s+(\d+)\s+aptitudes/i.exec(b) ?? /(\d+)\s+of\s+(\d+)\s+skills/i.exec(b);
    if (m && Number(m[2]) > 0) return Number(m[1]) / Number(m[2]);
  }
  return null;
}

const containsKeyword = (text: string, keywords: readonly string[]): string | null => {
  for (const k of keywords) {
    const kw = foldText(k).trim();
    if (!kw) continue;
    // "vp " en la blocklist lleva espacio a propósito: coincide "vp engineering", no "mvp"
    const re = new RegExp(
      `(^|[^a-z0-9])${kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|[^a-z0-9])`,
    );
    if (re.test(text)) return k;
  }
  return null;
};

export function prefilter(
  input: PrefilterInput,
  rules: CriteriaRules,
  options: PrefilterOptions = {},
): PrefilterResult {
  // `undefined` (sin parámetro) = AR; `null` = desconocido. Con país explícito (o null) además se
  // marca el aviso que nombra solo países ajenos; sin parámetro no, para no mover los evals.
  const explicitCountry = options.userCountry !== undefined;
  const userCountry =
    options.userCountry === null ? null : (options.userCountry ?? "AR").toUpperCase();
  const manyFrom = options.manyCandidatesFrom ?? 100;
  const title = foldText(input.title);
  const location = foldText(input.locationRaw ?? "");
  const flags: string[] = [];

  // 1. Modalidad: bloqueador duro
  if (input.modality === "presencial" || input.modality === "hibrido") {
    return { pass: false, reason: "modalidad_no_remota", detail: `modalidad ${input.modality}` };
  }
  // El título contradice a la fuente: gana el título, también con modality "remoto".
  if (titleNonRemoteSignal(title)) {
    return { pass: false, reason: "modalidad_no_remota", detail: `título: ${input.title}` };
  }
  if (input.modality !== "remoto" && NON_REMOTE_IN_TEXT.test(location)) {
    return {
      pass: false,
      reason: "modalidad_no_remota",
      detail: `ubicación: ${input.locationRaw}`,
    };
  }

  // 2. Disciplina distinta por keywords en el título: bloqueador duro.
  //    ML engineer y evaluación de IA descartan siempre. Una keyword de dominio (growth, seo,
  //    pagos...) no descarta un título con señal clara de IA ("Senior AI Engineer — Growth",
  //    golden 30): es un rol de IA en ese dominio; queda como flag para el evaluador.
  const adjacent =
    containsKeyword(title, rules.ml_engineer_keywords) ??
    containsKeyword(title, rules.ai_eval_keywords);
  if (adjacent) {
    return {
      pass: false,
      reason: "disciplina_distinta",
      detail: `keyword '${adjacent}' en el título`,
    };
  }
  // Avisos que no son IT. Las bases de RR. HH. descartan siempre; los otros oficios, salvo que el
  // título tenga señal IT o de IA.
  const hrPool = HR_POOL_TITLE.find((p) => p.re.test(title));
  if (hrPool) {
    return {
      pass: false,
      reason: "disciplina_distinta",
      detail: `título fuera de IT: '${hrPool.label}'`,
    };
  }
  if (!hasItSignal(title)) {
    const nonIt = NON_IT_TITLE.find((p) => p.re.test(title));
    if (nonIt) {
      return {
        pass: false,
        reason: "disciplina_distinta",
        detail: `título fuera de IT: '${nonIt.label}'`,
      };
    }
  }
  const domain = containsKeyword(title, rules.other_discipline_keywords);
  if (domain) {
    if (!AI_TITLE.test(title)) {
      return {
        pass: false,
        reason: "disciplina_distinta",
        detail: `keyword '${domain}' en el título`,
      };
    }
    flags.push(`domain_keyword:${domain}`);
  }

  // 3. Badge de aptitudes
  const ratio = input.skillsMatchRatio ?? skillsMatchRatioFromBadges(input.badges);
  if (ratio !== null && ratio < rules.skills_match_badge.discard_below) {
    return {
      pass: false,
      reason: "badge_aptitudes",
      detail: `aptitudes ${(ratio * 100).toFixed(0)}% < ${rules.skills_match_badge.discard_below * 100}%`,
    };
  }
  if (ratio !== null && ratio >= rules.skills_match_badge.analyze_from)
    flags.push("skills_match_high");

  // 4. Título en blocklist (salvo allowlist), con la excepción calibrada (caso golden 13)
  let cap: number | null = null;
  const allowed = containsKeyword(title, rules.title_allowlist);
  const blocked = allowed ? null : containsKeyword(title, rules.title_blocklist);
  if (blocked) {
    const exc = rules.title_cap_score_if_few_candidates;
    const fewCandidates =
      input.candidatesCount !== null &&
      input.candidatesCount !== undefined &&
      input.candidatesCount <= exc.max_candidates;
    const isAi = exc.disciplines.includes("ai_engineer") && AI_TITLE.test(title);
    if (fewCandidates && isAi) {
      cap = exc.cap;
      flags.push("title_cap");
    } else {
      return { pass: false, reason: "titulo_blocklist", detail: `'${blocked}' en el título` };
    }
  }

  // 5. Ubicación: riesgo, nunca descarte
  //    La regla por texto de región ajena solo suma el flag, igual que el resto. El huso horario
  //    de EE.UU. es riesgo de horario, no de ubicación: no va acá.
  const countries = input.countriesAllowed?.map((c) => c.toUpperCase()) ?? null;
  const userNames = userCountry ? countryNames(userCountry) : [];
  const mentionsUser = userCountry
    ? userNames.length
      ? userNames.some((n) => location.includes(n))
      : location.includes(userCountry.toLowerCase())
    : false;
  let locationRisk = false;
  if (countries?.length) {
    locationRisk =
      !countries.includes("*") && (userCountry === null || !countries.includes(userCountry));
  } else if (!ANYWHERE.test(location)) {
    if (REMOTE_NO_COUNTRY.test(location)) {
      // "LATAM", "remote", "remoto" sin país explícito del candidato
      locationRisk = !mentionsUser;
    }
    // "US-based", "Americas", "EMEA": región o país ajeno sin el del candidato
    if (FOREIGN_REGION.test(location) && !mentionsUser) locationRisk = true;
    // País de la región que no es el del candidato ("Argentina only" para un perfil MX)
    if (explicitCountry && !mentionsUser && countriesMentioned(location).length)
      locationRisk = true;
  }
  if (locationRisk) flags.push("location_risk");

  // 6. Candidatos: riesgo
  if (
    input.candidatesCount !== null &&
    input.candidatesCount !== undefined &&
    input.candidatesCount >= manyFrom
  ) {
    flags.push("many_candidates");
  }

  return { pass: true, cap, flags };
}
