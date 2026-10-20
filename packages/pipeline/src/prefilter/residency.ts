import { foldText } from "../normalize/text";
import { allowsCountry, placesIn, type Region } from "../pool/location-scope";

/**
 * Residencia exigida en un país ajeno (ronda 66). Un aviso "Remote" puede decir en el texto
 * "must be based in Canada": la modalidad es remota pero la persona tiene que vivir en otro lado.
 * Determinista y de falla abierta: si no reconoce la frase, no reconoce los países, la lista incluye
 * el país de la persona (o una región que lo incluye) o hay una mención de huso horario, devuelve
 * `null`. Un falso positivo marca el aviso, así que la frase tiene que ser inequívoca.
 */
export type ResidencyRestriction = { countries: string[]; regions: Region[]; phrase: string };

/** Prefijo del flag del prefiltro: `residencia_exigida:CA,US`. */
export const RESIDENCY_FLAG = "residencia_exigida";

/** Frases que anuncian "los candidatos tienen que estar en ...". Terminan justo antes de la lista. */
const TRIGGERS: readonly RegExp[] = [
  // inglés
  /must\s+(?:currently\s+|physically\s+)*be\s+(?:based|located|living|residing)\s+(?:in|within)\b/g,
  /must\s+(?:currently\s+)?(?:reside|live)\s+(?:in|within)\b/g,
  /(?:must|need\s+to|have\s+to|required\s+to)\s+be\s+(?:an?\s+)?(?:legal\s+|permanent\s+|current\s+)?residents?\s+of\b/g,
  /(?:only|open\s+to)\s+(?:legal\s+)?residents\s+of\b/g,
  /only\s+(?:candidates|applicants|people|those)\s+(?:who\s+(?:are\s+)?)?(?:(?:based|located|residing|living)\s+)?(?:in|from|within)\b/g,
  /open\s+(?:only\s+)?to\s+(?:candidates|applicants)\s+(?:(?:based|located|residing|living)\s+)?(?:in|from|within)\b/g,
  // español
  /deb(?:es|e|en)\s+(?:residir|vivir)\s+en\b/g,
  /deb(?:es|e|en)\s+(?:estar|ser)\s+(?:radicad[oa]s?|residentes?|ubicad[oa]s?)\s+(?:en|de)\b/g,
  /(?:solo|solamente|unicamente)\s+(?:para\s+)?(?:personas|candidatos|postulantes|profesionales)\s+(?:que\s+(?:residan|vivan|esten\s+radicad[oa]s)|radicad[oa]s|residentes)\s+en\b/g,
];

/** Palabra "only" suelta; el resto del análisis se hace a mano, sin regex que retroceda. */
const ONLY_WORD = /\bonly\b/g;
/** Después de "only" tiene que venir el fin de la cláusula. */
const CLAUSE_END_AFTER = /^[^\S\n]*(?:$|[.\n;,)\]])/;

/** Dónde termina la lista de lugares que sigue a la frase: oración, línea, paréntesis, ":" o cláusula nueva. */
const TAIL_END =
  /[.!?;:(\n]|\s(?:with|who|that|where|which|because|as|to|for|but)\s|\sand\s(?:have|be|are|can|work|speak|must)\s/;

const MAX_PHRASE = 120;
/** Cuánto de la lista se analiza: generoso, porque las listas largas de países existen. */
const MAX_LIST = 600;
/** Tope del texto analizado (una JD normal está muy por debajo). */
const MAX_TEXT = 20_000;
/** Tope de "only" evaluados por texto (costo adversarial). */
const MAX_ONLY = 50;
/** Tope de coincidencias por frase explícita. */
const MAX_PER_TRIGGER = 50;

/**
 * El texto como lo ve `location-scope`: plegado, con las siglas de EE.UU. como "united states" y
 * el pronombre "us" fuera ("contact us" no es un país). Solo cuentan "US", "USA" y "U.S." en
 * mayúsculas del texto original; en un texto casi todo en mayúsculas "US" es ambiguo y no se
 * interpreta (falla abierto). Colapsa corridas de espacios y de saltos de línea.
 */
function normalize(text: string): string {
  const sliced = text.slice(0, MAX_TEXT);
  const letters = sliced.match(/[A-Za-z]/g)?.length ?? 0;
  const upper = sliced.match(/[A-Z]/g)?.length ?? 0;
  const shouting = letters > 0 && upper / letters > 0.5;
  const original = sliced
    .replace(
      shouting
        ? /\bU\.S\.(?:A\.?)?|\bEE\.?\s?UU\.?/g
        : /\bU\.S\.(?:A\.?)?|\bUSA?\b|\bEE\.?\s?UU\.?/g,
      " united states ",
    )
    .replace(/\bus\b/gi, " ");
  return foldText(original)
    .replace(/[^\S\n]+/g, " ")
    .replace(/\s*\n\s*/g, "\n");
}

function cutTail(tail: string): string {
  const head = tail.slice(0, MAX_LIST);
  const end = head.search(TAIL_END);
  return end === -1 ? head : head.slice(0, end);
}

/** Lo que "<lugar> only" nombra: lo que sigue a la última preposición ("based in", "from", "for"). */
function afterLastPreposition(segment: string): string {
  const m = /^(?:.*\s)?(?:in|from|within|for|to|of)\s+(.*)$/s.exec(segment);
  return m ? m[1]! : segment;
}

type Candidate = { phrase: string; places: string };

function candidates(text: string): Candidate[] {
  const out: Candidate[] = [];
  for (const trigger of TRIGGERS) {
    let seen = 0;
    for (const m of text.matchAll(trigger)) {
      if (++seen > MAX_PER_TRIGGER) break;
      const rest = cutTail(text.slice(m.index! + m[0].length));
      out.push({ phrase: `${m[0]}${rest}`.trim().slice(0, MAX_PHRASE), places: rest });
      // `rest` va completo a placesIn: solo lo que se muestra se trunca.
    }
  }
  let evaluated = 0;
  for (const m of text.matchAll(ONLY_WORD)) {
    const end = m.index! + m[0].length;
    if (!CLAUSE_END_AFTER.test(text.slice(end, end + 8))) continue;
    if (++evaluated > MAX_ONLY) break;
    const list = placesBeforeOnly(text.slice(Math.max(0, m.index! - MAX_LIST), m.index!));
    if (list) out.push({ phrase: `${list} only`.slice(0, MAX_PHRASE), places: list });
  }
  return out;
}

const NOT_RESIDENCY_CLAUSE =
  /sponsor|visa|relocat|equity|bonus|benefit|salary|stipend|allowance|payroll|exclud|except|other than|but not/;
const HARD_BREAK = new Set([".", "!", "?", "\n", ";", ":", "(", ")", "[", "]"]);
/** Prefijos que no son lugar y acompañan al primer elemento ("remote", "the"). */
const LEADING_FILLER = /^(?:(?:the|remote|remoto|fully|only|from)\s+)+/;
const MAX_ELEMENT = 60;

/** Un elemento de la lista si es SOLO un lugar. `starts` = trae un prefijo ("based in X"): la lista empieza ahí. */
function placeElement(raw: string): { text: string; starts: boolean } | null {
  const el = raw.trim();
  if (!el || el.length > MAX_ELEMENT) return null;
  const afterDash = el
    .split(/\s[-–—]\s/)
    .pop()!
    .trim();
  const afterPrep = afterLastPreposition(afterDash);
  const noArticle = afterPrep.replace(/^the\s+/, "");
  const text = noArticle.replace(LEADING_FILLER, "").trim();
  if (!text || text.split(" ").length > 3 || !placesIn(text)) return null;
  // "the" no abre la lista ("Canada, the US only"); un prefijo, una preposición o un guion sí.
  return { text, starts: afterDash !== el || afterPrep !== afterDash || text !== noArticle.trim() };
}

/**
 * La lista de lugares pegada a "only", recorrida hacia atrás elemento por elemento (comas, "and",
 * "or"). Se sigue mientras cada elemento sea SOLO un lugar y se corta en el primero que no lo es;
 * el elemento adyacente a "only" tiene que ser un lugar, o no hay candidato ("…Toronto, Canada,
 * fully remote only" no restringe). Sin regex que retroceda sobre el texto.
 */
function placesBeforeOnly(before: string): string | null {
  let start = 0;
  for (let i = before.length - 1; i >= 0; i--) {
    if (HARD_BREAK.has(before[i]!)) {
      // Un ")" justo antes de la lista: la cláusula viene de un paréntesis anterior, no se interpreta.
      if (before[i] === ")") return null;
      start = i + 1;
      break;
    }
  }
  const clause = before.slice(start);
  // Beneficios y exclusiones no hablan de dónde vive la persona: "Visa sponsorship in the US only".
  if (NOT_RESIDENCY_CLAUSE.test(clause)) return null;
  const parts = clause.split(/\s*,\s*|\s+(?:and|or)\s+|\s*[&/]\s*/);
  const kept: string[] = [];
  for (let i = parts.length - 1; i >= 0; i--) {
    const el = placeElement(parts[i]!);
    if (!el) break;
    kept.unshift(el.text);
    if (el.starts) break;
  }
  return kept.length ? kept.join(", ") : null;
}

/**
 * Devuelve la restricción si el aviso exige residir en lugares que no incluyen a `userCountry`.
 * Con `userCountry` nulo, sin frase reconocida o sin lugares reconocidos, `null`.
 */
export function detectResidencyRestriction(
  text: string | null,
  userCountry: string | null,
): ResidencyRestriction | null {
  if (!text?.trim() || !userCountry) return null;
  const user = userCountry.trim().toUpperCase();
  let restriction: ResidencyRestriction | null = null;
  for (const c of candidates(normalize(text))) {
    if (/\banywhere\b/.test(c.places)) return null;
    const places = placesIn(c.places);
    if (!places) continue;
    // Una frase que admite a la persona manda sobre las demás: ante la duda, no restringe.
    if (allowsCountry({ kind: "places", ...places }, user)) return null;
    restriction ??= { ...places, phrase: c.phrase };
  }
  return restriction;
}
