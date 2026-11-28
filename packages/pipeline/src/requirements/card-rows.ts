import type { Checklist, ChecklistItem, ChecklistStatus } from "../evaluator/checklist";
import { englishRankFromCefr } from "../decide";
import { err, ok, type Result } from "../result";
import type { JobCard, JobCardRequirement } from "../job-card/schema";
import { foldText } from "../normalize/text";
import { countriesMentioned } from "../normalize/location";
import { extractJdSkills, type Term } from "../skills/match";

/**
 * Filas `req:<n>` de la tabla de requisitos (R31-05, fase B de `checklist.ts`). Puro: recibe la ficha
 * del aviso (ya verificada contra el texto, cada dato con su cita), el perfil y las respuestas de un
 * toque, y devuelve filas de la tabla. El modelo dijo qué pide el aviso y dónde lo dice; acá el
 * **código** decide el estado, comparando solo lo que se puede comparar:
 *
 * - Coincide / No coincide solo con un dato explícito del perfil (o la respuesta de la persona).
 * - Lo que no se puede comparar queda `no_se_sabe` («Sin confirmar») y lleva una `pregunta` de un
 *   toque (Sí, No o En parte); la respuesta vale para cualquier oferta que pida lo mismo
 *   (`requirementKey`).
 * - Nada de esto bloquea: los bloqueadores los decide `decide()`.
 *
 * Nada se deduce: los países, el nivel de idioma y los años salen del texto del requisito y de su
 * cita; si no están, no se compara.
 */

export type RequirementAnswerValue = "si" | "no" | "en_parte";
export type RequirementAnswer = { valor: RequirementAnswerValue; nota?: string | null };

export type CardRowsInput = {
  /** La parte de la ficha que se usa: los requisitos y las condiciones (el nivel de inglés). */
  card: Pick<JobCard, "requisitos" | "condiciones">;
  profile: {
    yearsTotal?: number | null;
    englishCefr?: string | null;
    locationCountry: string;
    workAuth: { us: boolean; eu: boolean; other?: readonly string[] };
  };
  /** Filas que la tabla ya tiene: sirven para no repetir (el inglés, una sola vez). */
  existing: readonly Pick<ChecklistItem, "id">[];
  /** Respuestas de un toque de la persona, por `requirementKey`. */
  answers: ReadonlyMap<string, RequirementAnswer>;
  skillLevels: ReadonlyMap<string, number>;
  userSkills: readonly { name: string; level: number }[];
  terms: readonly Term[];
  skillNames?: ReadonlyMap<string, string>;
};

/** Máximo de filas del aviso en la tabla (la tabla entera tiene tope de 40: ver `CHECKLIST_MAX_ITEMS`). */
export const CARD_ROWS_MAX = 10;
const TABLE_MAX = 40;
const EVIDENCE_MAX = 600; // mismo tope que el contrato de la web (`evidencia`)
const NOTE_MAX = 200; // idem `nota`
export const REQUIREMENT_KEY_MAX = 160;

const ANSWER_LABEL: Record<RequirementAnswerValue, string> = {
  si: "Sí",
  no: "No",
  en_parte: "En parte",
};
const ANSWER_VALUES = new Set<string>(["si", "no", "en_parte"]);

const squash = (s: string): string =>
  foldText(s)
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
const clipTo = (s: string, max: number): string => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/** Lo que dice el requisito: su texto y su cita (las dos, ya verificadas contra el aviso). */
const said = (r: JobCardRequirement): string => `${r.texto} ${r.cita}`;

const isEnglish = (r: JobCardRequirement): boolean =>
  /^(ingles|english)\b/.test(squash(r.idioma ?? "")) ||
  (r.idioma === null && /\b(ingles|english)\b/.test(squash(said(r))));

// --- Nivel de idioma: 1 básico … 4 nativo, o null si el texto no lo dice con claridad ----------------

const LEVEL_WORDS: ReadonlyArray<readonly [RegExp, number]> = [
  [/\b(basico|basic|elemental|beginner)\b/, 1],
  [/\b(intermedio|intermedia|intermediate|conversacional)\b/, 2],
  [/\b(avanzado|avanzada|advanced|fluido|fluida|fluent)\b/, 3],
  [/\b(nativo|nativa|native|bilingue|bilingual)\b/, 4],
];

function levelRank(text: string): number | null {
  const folded = squash(text);
  const ranks = new Set<number>();
  const cefr = /\b([abc][12])\b/.exec(folded);
  const fromCefr = cefr ? englishRankFromCefr(cefr[1]) : null;
  if (fromCefr !== null) ranks.add(fromCefr);
  for (const [re, rank] of LEVEL_WORDS) if (re.test(folded)) ranks.add(rank);
  return ranks.size === 1 ? [...ranks][0]! : null; // dos niveles distintos: no se elige uno
}

const CARD_LEVEL: Record<string, number> = { basico: 1, intermedio: 2, avanzado: 3, nativo: 4 };
const RANK_NAME = ["", "basico", "intermedio", "avanzado", "nativo"];

function requiredEnglishRank(r: JobCardRequirement, card: CardRowsInput["card"]): number | null {
  const own = levelRank(said(r));
  if (own !== null) return own;
  const n = card.condiciones.ingles?.nivel;
  return n ? (CARD_LEVEL[n] ?? null) : null; // `sin_nivel` no está en la tabla: null
}

// --- Años: ¿el requisito es de años de experiencia en general o en un rubro? --------------------------

const GENERIC_YEARS_WORDS = new Set([
  "anos",
  "ano",
  "years",
  "year",
  "de",
  "en",
  "total",
  "experiencia",
  "laboral",
  "previa",
  "profesional",
  "minimo",
  "minima",
  "al",
  "menos",
  "mas",
  "mayor",
  "o",
  "igual",
  "a",
  "of",
  "experience",
  "at",
  "least",
  "work",
  "working",
  "professional",
  "minimum",
  "y",
  "la",
  "el",
  "trabajo",
  "trabajando",
  "demostrable",
  "comprobable",
]);

/** «3 años de experiencia»: sin rubro. Con rubro («como analista de datos») el total del perfil no alcanza. */
function isGenericYears(texto: string): boolean {
  const words = squash(texto).replace(/\d+/g, " ").split(/\s+/).filter(Boolean);
  return words.length > 0 && words.every((w) => GENERIC_YEARS_WORDS.has(w));
}

// --- Países ------------------------------------------------------------------------------------------

const countriesOf = (r: JobCardRequirement): string[] =>
  countriesMentioned(foldText(said(r)), { outsideRegion: true });

const US_RE = /\b(eeuu|ee uu|usa|us|u s|estados unidos|united states)\b/;
const EU_RE = /\b(ue|eu|union europea|europea|europe|europa|schengen)\b/;

// --- Clave -------------------------------------------------------------------------------------------

function habilidadSlug(r: JobCardRequirement, terms: readonly Term[]): string | null {
  if (terms.length === 0) return null;
  const slugs = extractJdSkills(r.texto, terms).filter((s) => !s.startsWith("english_"));
  return slugs.length === 1 ? slugs[0]! : null;
}

/**
 * Clave estable de lo que pide un requisito, para que la respuesta de la persona valga en las demás
 * ofertas que pidan lo mismo (aunque lo redacten distinto). Las categorías con datos que el código
 * puede leer (idioma y nivel, años, países, habilidad) usan esos datos; el resto, el texto normalizado.
 */
export function requirementKey(r: JobCardRequirement, terms: readonly Term[] = []): string {
  let key: string | null = null;
  switch (r.categoria) {
    case "idioma": {
      const idioma = squash(r.idioma ?? "");
      if (idioma) {
        const rank = levelRank(said(r));
        key = `idioma:${idioma}:${rank ? RANK_NAME[rank] : "-"}`;
      }
      break;
    }
    case "experiencia":
      if (typeof r.anos === "number") {
        key = `experiencia:${r.anos}:${isGenericYears(r.texto) ? "-" : squash(r.texto)}`;
      }
      break;
    case "ubicacion":
    case "residencia":
    case "autorizacion": {
      const codes = [...countriesOf(r)].sort();
      if (codes.length) key = `${r.categoria}:${codes.join(",")}`;
      break;
    }
    case "habilidad": {
      const slug = habilidadSlug(r, terms);
      if (slug) key = `habilidad:${slug}`;
      break;
    }
    default:
      break;
  }
  return clipTo(key ?? `${r.categoria}:${squash(r.texto)}`, REQUIREMENT_KEY_MAX);
}

// --- Comparación -------------------------------------------------------------------------------------

type Compared = { status: ChecklistStatus; tenes: string | null; slug?: string };
const UNKNOWN: Compared = { status: "no_se_sabe", tenes: null };

function compare(r: JobCardRequirement, input: CardRowsInput): Compared {
  const { profile } = input;

  switch (r.categoria) {
    case "idioma": {
      if (!isEnglish(r)) return UNKNOWN; // el perfil solo tiene el nivel de inglés
      const pedido = requiredEnglishRank(r, input.card);
      const mio = englishRankFromCefr(profile.englishCefr);
      if (pedido === null || mio === null) return UNKNOWN;
      return { status: pedido <= mio ? "cumple" : "no_cumple", tenes: profile.englishCefr ?? null };
    }
    case "experiencia": {
      const tiene = profile.yearsTotal ?? null;
      if (typeof r.anos !== "number" || tiene === null) return UNKNOWN;
      const tenes = `${tiene} años`;
      if (tiene < r.anos) return { status: "no_cumple", tenes }; // ni el total llega
      return isGenericYears(r.texto) ? { status: "cumple", tenes } : UNKNOWN; // con rubro: no se sabe
    }
    case "ubicacion":
    case "residencia": {
      const places = countriesOf(r);
      const mio = profile.locationCountry.trim().toUpperCase();
      if (places.length === 0 || !mio) return UNKNOWN;
      return { status: places.includes(mio) ? "cumple" : "no_cumple", tenes: mio };
    }
    case "autorizacion": {
      const folded = squash(said(r));
      const wantsUs = US_RE.test(folded);
      const wantsEu = EU_RE.test(folded);
      const other = (profile.workAuth.other ?? []).map((c) => c.trim().toUpperCase());
      const held = (wantsUs && profile.workAuth.us) || (wantsEu && profile.workAuth.eu);
      const heldText = [profile.workAuth.us ? "US" : null, profile.workAuth.eu ? "UE" : null]
        .concat(other)
        .filter(Boolean)
        .join(", ");
      if (held) return { status: "cumple", tenes: `Autorización: ${heldText}` };
      // Solo EE. UU. y la UE tienen una marca explícita en el perfil: ahí «no» es un dato explícito.
      // Para cualquier otro lugar (o si no se lee cuál) no hay dato: sin confirmar.
      if ((wantsUs || wantsEu) && countriesOf(r).every((c) => c === "US")) {
        return {
          status: "no_cumple",
          tenes: heldText ? `Autorización: ${heldText}` : "Sin autorización fuera de tu país",
        };
      }
      return UNKNOWN;
    }
    case "habilidad": {
      const slug = habilidadSlug(r, input.terms);
      if (slug === null) return UNKNOWN; // ninguna o varias: no se elige una por la persona
      const name = input.skillNames?.get(slug) ?? slug.replace(/_/g, " ");
      const byName = input.userSkills.find(
        (u) => foldText(u.name).trim() === foldText(name).trim(),
      );
      const level = input.skillLevels.get(slug) ?? byName?.level ?? null;
      if (level === null) return { status: "no_se_sabe", tenes: null, slug };
      return { status: level >= 2 ? "cumple" : "no_cumple", tenes: `Nivel ${level} de 3`, slug };
    }
    default:
      return UNKNOWN;
  }
}

/** ¿La tabla ya dice esto con una fila fija? Se deja una sola. */
function alreadyInTable(r: JobCardRequirement, ids: ReadonlySet<string>, slug?: string): boolean {
  switch (r.categoria) {
    case "idioma":
      return isEnglish(r) && ids.has("ingles");
    case "experiencia":
      return ids.has("anos");
    case "ubicacion":
    case "residencia":
      return ids.has("pais") || ids.has("residencia");
    case "autorizacion":
      return ids.has("autorizacion");
    case "habilidad":
      return slug !== undefined && ids.has(`skill:${slug}`);
    default:
      return false;
  }
}

export function buildCardRows(input: CardRowsInput): ChecklistItem[] {
  const room = Math.max(0, Math.min(CARD_ROWS_MAX, TABLE_MAX - input.existing.length));
  const ids = new Set(input.existing.map((e) => e.id));
  const seen = new Set<string>();
  const rows: ChecklistItem[] = [];

  input.card.requisitos.forEach((r, i) => {
    if (rows.length >= room) return;
    const key = requirementKey(r, input.terms);
    if (seen.has(key)) return;
    const cmp = compare(r, input);
    if (alreadyInTable(r, ids, cmp.slug)) return;
    seen.add(key);

    // Lo que no se puede comparar con el perfil ofrece la pregunta, y si ya la respondió, vale
    const base: ChecklistItem = {
      id: `req:${i + 1}`,
      kind: "texto",
      nivel: r.nivel === "indispensable" ? "must" : "deseable",
      pide: r.texto,
      evidencia: clipTo(r.cita, EVIDENCE_MAX),
      tenes: cmp.tenes,
      status: cmp.status,
      fuente: { pide: "modelo", tenes: cmp.tenes === null ? null : "perfil" },
      bloquea: false,
    };
    rows.push(cmp.status === "no_se_sabe" ? withAnswer(base, key, input.answers) : base);
  });

  return rows;
}

/** Pone (o saca) la respuesta de la persona en una fila que el perfil no puede comparar. */
function withAnswer(
  row: ChecklistItem,
  clave: string,
  answers: ReadonlyMap<string, RequirementAnswer>,
): ChecklistItem {
  const { nota: _nota, ...rest } = row;
  const saved = answers.get(clave);
  const valor = saved && ANSWER_VALUES.has(saved.valor) ? saved.valor : null;
  const note =
    valor === "en_parte" && saved?.nota?.trim() ? clipTo(saved.nota.trim(), NOTE_MAX) : null;
  const pregunta = { clave, respuesta: valor, nota: note };
  if (!valor) {
    return {
      ...rest,
      status: "no_se_sabe",
      tenes: null,
      fuente: { ...row.fuente, tenes: null },
      pregunta,
    };
  }
  return {
    ...rest,
    status: valor === "si" ? "cumple" : valor === "no" ? "no_cumple" : "no_se_sabe",
    tenes: `Tu respuesta: ${ANSWER_LABEL[valor]}`,
    fuente: { ...row.fuente, tenes: "perfil" },
    pregunta,
    ...(note ? { nota: note } : {}),
  };
}

const countsOf = (items: readonly ChecklistItem[], nivel: ChecklistItem["nivel"]) => {
  const c = { cumple: 0, no_cumple: 0, no_se_sabe: 0 };
  // Mismo criterio que buildChecklist: las habilidades que nombra el aviso no entran al titular
  for (const it of items) if (it.kind !== "skill" && it.nivel === nivel) c[it.status]++;
  return c;
};

/**
 * Aplica las respuestas de un toque a una tabla ya guardada, sin volver a evaluar ni llamar a ningún
 * modelo (R31-08): solo cambian las filas que traen `pregunta` (las que el perfil no pudo comparar);
 * se rehacen los conteos. Sin respuesta para una clave, la fila vuelve a «Sin confirmar». Puro: no
 * muta lo que recibe.
 */
export function applyRequirementAnswers<C extends Pick<Checklist, "items" | "must" | "deseable">>(
  checklist: C,
  answers: ReadonlyMap<string, RequirementAnswer>,
): C {
  const items = checklist.items.map((it) =>
    it.pregunta ? withAnswer(it, it.pregunta.clave, answers) : it,
  );
  return {
    ...checklist,
    items,
    must: countsOf(items, "must"),
    deseable: countsOf(items, "deseable"),
  };
}

// --- Lo que llega del navegador ----------------------------------------------------------------------

const KEY_SHAPE =
  /^(idioma|experiencia|ubicacion|residencia|autorizacion|formacion|habilidad|otro):[^\p{Cc}]*$/u;

/**
 * Valida la respuesta de un toque que manda la persona. Falla cerrado: devuelve solo el nombre del
 * campo que no sirve, nunca el valor. La clave tiene que tener la forma de `requirementKey`.
 */
export function parseRequirementAnswerInput(
  raw: unknown,
): Result<
  { clave: string; valor: RequirementAnswerValue; nota: string | null },
  "clave" | "valor" | "nota"
> {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const { clave, valor, nota } = o;
  if (
    typeof clave !== "string" ||
    clave.length < 1 ||
    clave.length > REQUIREMENT_KEY_MAX ||
    !KEY_SHAPE.test(clave)
  ) {
    return err("clave");
  }
  if (typeof valor !== "string" || !ANSWER_VALUES.has(valor)) return err("valor");
  if (nota !== undefined && nota !== null && typeof nota !== "string") return err("nota");
  const trimmed = typeof nota === "string" ? nota.trim() : "";
  if (trimmed.length > NOTE_MAX) return err("nota");
  return ok({
    clave,
    valor: valor as RequirementAnswerValue,
    nota: valor === "en_parte" && trimmed ? trimmed : null,
  });
}
