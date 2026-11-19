import { renderJob, type JobForPrompt } from "../evaluation";
import { foldText } from "../normalize/text";

/** Flag que el worker agrega a los de `decide()` y persiste en `jobs.flags`. */
export const INJECTION_FLAG = "injection_suspect";
/** Riesgo visible que `decide()` suma cuando el aviso trae instrucciones para el evaluador. */
export const INJECTION_RISK = "aviso con instrucciones al evaluador";

/**
 * Patrones conservadores sobre texto ya plegado (minúsculas, sin acentos). Un falso positivo solo
 * topa el score en "guardar" y agrega un riesgo visible; un falso negativo no tiene tope. Por eso
 * son frases dirigidas al modelo y no palabras sueltas ("sistema", "instrucciones", "json").
 */
/** A quién se dirige un pedido de nota: la persona, el aviso o la oferta (texto plegado). */
const TARGET_SRC =
  "(?:this|that|the|these|este|esta|ese|esa|el|la|al|tu|su|dicho|dicha)\\s+(?:\\w+\\s+)?(?:candidate|applicant|candidato|candidata|perfil|postulante|aplicante|aviso|oferta|posting|job|role|persona|cv|resume|curriculum|puesto|vacante|posicion)\\b";
const TARGET_RE = new RegExp(TARGET_SRC);

/** Palabras de nota máxima y adjetivos de "la nota correcta", compartidos por los patrones sin verbo. */
const MAX_SRC = "(?:10|9|diez|nueve|ten|nine|maxim[ao]|maximum|highest|perfect[ao]?|alt[ao]|high)";
const GRADE_SRC = "(?:score|puntaje|nota|puntuacion|calificacion|rating|grade)";
const ADJ_SRC = "(?:correct[oa]?|final|right|expected|esperad[ao])";
const FOR_SRC = "(?:(?:for|para|of|de)\\s+(?:this|the|este|esta)\\s+\\w+\\s+)";

type Pattern = {
  name: string;
  re: RegExp;
  /**
   * Condición extra para que la frase cuente como dirigida al evaluador: `match` mira solo el texto
   * que saltó, `sentence` mira también la oración que lo rodea (hasta 100 caracteres a cada lado).
   */
  needs?: { re: RegExp; scope: "match" | "sentence" };
};

const PATTERNS: readonly Pattern[] = [
  {
    name: "ignorar_instrucciones",
    re: /\bignor(?:a|e)\s+(?:todas\s+)?(?:las\s+)?(?:instrucciones|reglas)\s+(?:anteriores|previas|del sistema)/,
  },
  {
    name: "ignore_previous",
    re: /\bignore\s+(?:(?:all|any|the|your|these|those|my|of)\s+){0,3}(?:(?:previous|prior|above|earlier|preceding|former)\s+(?:instructions|rules|directions|guidelines|prompts?)|(?:instructions|rules|directions|guidelines)\s+(?:above|before|given\s+(?:above|before|earlier)|so\s+far|you\s+(?:were|have\s+been)\s+given))/,
  },
  // Solo cuando se pide o se redefine el prompt: "system prompt design" en un aviso de IA es normal
  {
    name: "system_prompt",
    re: /\b(?:reveal\w*|show|print|repeat|output|leak|dump|display|your|new|mostra\w*|muestra\w*|revela\w*|imprim\w*|repet\w*|tu|tus)\s+(?:the\s+|your\s+|el\s+|tu\s+)?system\s+prompt\b|\bsystem\s+prompt\s*[:=]/,
  },
  {
    name: "ignorar_otros_idiomas",
    re: /\b(?:ignorez|ignorer|oubliez|negligez|ignoriere\w*|ignorieren|vergiss|missachte\w*|desconsider\w*|desprez\w*|esquec\w*)\s+(?:(?:todas?|todos?|tous|toutes|alle|alles|as|os|les|des|die|der|den|diese|ihre|deine|vos|vuestras?|tes|ses|suas?|seus?|tus|sus)\s+){0,3}(?:(?:instruc\w*|instruct\w*|reglas?|regras?|regles?|consignes?|directives?)\s+(?:anteriores|previas|previos|precedentes|prece\w+|ci-dessus)|(?:vorherigen|fruheren|vorigen|obigen)\s+(?:anweisungen|regeln|vorgaben|befehle|instruktionen)|(?:lo|tudo|tout)\s+(?:anterior|isso|ce\s+qui))/,
  },
  {
    name: "valor_accion",
    re: /\baplicar_personalizado\b|\b(?:como|as|to|en|a)\s+aplicar\s+personalizado\b|[:=]\s*aplicar[_\s]personalizado\b/,
  },
  {
    name: "nota_requerida",
    re: new RegExp(
      `\\b(?:the|el|la|este|esta)\\s+(?:${ADJ_SRC}\\s+)?${GRADE_SRC}\\s+(?:${ADJ_SRC}\\s+)?${FOR_SRC}?(?:(?:must|should|needs\\s+to|has\\s+to)\\s+be|debe\\s+ser|tiene\\s+que\\s+ser|deberia\\s+ser|tendria\\s+que\\s+ser)\\s+${MAX_SRC}\\b`,
    ),
  },
  {
    // "es"/"is" solo cuenta si la nota se llama correcta o final, o se dice para este aviso/candidato
    name: "nota_correcta",
    re: new RegExp(
      `\\b(?:the|el|la)\\s+(?:${ADJ_SRC}\\s+)?${GRADE_SRC}\\s+(?:${ADJ_SRC}\\s+)?${FOR_SRC}?(?:es|is)\\s+${MAX_SRC}\\b`,
    ),
    needs: {
      re: new RegExp(`\\b${ADJ_SRC}\\b|${TARGET_SRC}`),
      scope: "match",
    },
  },
  { name: "you_are_now", re: /\byou\s+are\s+now\s+(?:a|an)\b/ },
  { name: "act_as_ai", re: /\bact\s+as\s+(?:a|an)\s+(?:ai|assistant|language model)\b/ },
  {
    name: "disregard_previous",
    re: /\b(?:disregard|forget|override|skip)\s+(?:(?:all|any|the|your|these|those|my|of)\s+){0,3}(?:(?:previous|prior|above|earlier|preceding|former)\s+(?:instructions|rules|directions|guidelines|prompts?)|(?:instructions|rules|directions|guidelines)\s+(?:above|before|given\s+(?:above|before|earlier)|so\s+far|you\s+(?:were|have\s+been)\s+given))/,
  },
  { name: "olvidar_anterior", re: /\bolvid(?:a|e)\s+(?:todo\s+)?lo\s+anterior/ },
  { name: "ignorar_todo_anterior", re: /\bignor(?:a|e)\s+todo\s+lo\s+anterior/ },
  { name: "nuevas_instrucciones", re: /\bnuevas\s+instrucciones\b/ },
  { name: "new_instructions", re: /\bnew\s+instructions\b/ },
  {
    name: "poner_score_alto",
    re: /\b(?:pone|asigna|dale|give|assign|set)\s+(?:un\s+|a\s+)?(?:score|puntaje|puntuacion)\s+(?:de\s+|of\s+)?(?:9|10)\b/,
  },
  { name: "score_alto", re: /\bscore:?\s?(?:9|10)\s?\/\s?10\b/ },
  { name: "campo_accion_sugerida", re: /\baccion_sugerida\b/ },
  { name: "campo_bloqueadores_duros", re: /\bbloqueadores_duros\b/ },
  { name: "campo_match_fuerte", re: /\bmatch_fuerte\b/ },
  { name: "veredicto_campo", re: /\bveredicto:/ },
  {
    name: "responder_solo_con",
    re: /\brespond(?:e)?\s+(?:only|solo|unicamente)\s+(?:with|con)\b/,
  },
  { name: "do_not_evaluate", re: /\bdo\s+not\s+evaluate\b/ },
  { name: "no_evalues", re: /\bno\s+evalue(?:s)?\b/ },
  // Solo junto a "AVISO": `<<<` y `>>>` sueltos aparecen en heredocs y en Python
  { name: "marca_apertura", re: /<<<\s*(?:fin\s+)?aviso/ },
  { name: "marca_cierre", re: /aviso\s*>>>/ },
  { name: "token_inst", re: /\[inst\]/ },
  { name: "token_im_start", re: /<\|im_start\|>/ },
  { name: "bloque_json", re: /```\s*json/ },
  { name: "encabezado_rol", re: /###\s*(?:system|instruction|assistant)\b/ },
  // Señales por intención: un verbo de mandato cerca de nota/puntaje, o pedir que se ignore lo anterior.
  // Las repeticiones están acotadas ({0,n}) y cada una consume palabras enteras: costo lineal.
  {
    name: "ignorar_indicaciones",
    re: /\b(?:ignor(?:a|e|ar|ad|en)|descart(?:a|e|ar|ad)|desestim(?:a|e|ar|ad)|omit(?:e|ir)|saltea(?:te)?|desatend(?:e|er)|desatended)\s+(?:(?:todas?|todo|el|la|las|los|lo|as|os|tus?|sus?|vuestras?|mis|estas|esas|nuestras)\s+){0,2}(?:(?:instruc\w*|reglas?|regras|indicaciones)\s+(?:anteriores|previas|previos)|(?:lo\s+)?(?:indicado|anterior|escrito)\b)/,
  },
  {
    name: "pasar_por_alto",
    re: /\bpasa(?:r)?\s+por\s+alto\s+(?:todo\s+)?(?:lo\s+)?(?:indicado|anterior|escrito|dicho)/,
  },
  {
    name: "mandato_nota",
    re: /\b(?:pone|poner|ponele|asigna|asignale|asignar|dale|califica|calificalo|calificar|puntua|otorga|otorgale|give|assign|rate|grade|set)\b(?:\W+\w+){0,4}?\W+(?:nota|score|puntaje|puntuacion|calificacion|rating|grade)\b(?:\W+(?:de|of|a|to|as|como))?\W+(?:maxim[ao]|alt[ao]|perfect[ao]?|max|maximum|highest|top|diez|ten|10|9|excelente)\b/,
    needs: { re: TARGET_RE, scope: "sentence" },
  },
  {
    name: "mandato_nota_maxima",
    re: /\b(?:pone|poner|ponele|asigna|asignale|asignar|dale|califica|calificalo|calificar|puntua|otorga|otorgale|give|assign|rate|grade|set)\b(?:\W+\w+){0,3}?\W+(?:maxim[ao]|maximum|highest|top|perfect[ao]?|alt[ao]|high|diez|ten)\s+(?:nota|score|puntaje|puntuacion|calificacion|rating|grade)\b/,
    needs: { re: TARGET_RE, scope: "sentence" },
  },
  {
    name: "calificar_diez_de_diez",
    re: /\b(?:rate|grade|califica|calificalo|puntua)\b(?:\W+\w+){0,6}?\W+(?:10|diez|ten)\s*(?:\/|out\s+of|de)\s*(?:10|diez|ten)\b/,
  },
  {
    name: "candidato_ideal_preaprobado",
    re: /\bcandidat[oa]\s+ideal\s+ya\s+(?:fue\s+|esta\s+)?(?:pre)?(?:seleccionad|aprobad|elegid)/,
  },
  {
    name: "candidato_perfecto",
    re: /\b(?:this\s+(?:candidate|applicant)\s+is\s+(?:a\s+|an\s+|the\s+)?(?:perfect|ideal|best|top)|este\s+(?:candidato|postulante)\s+es\s+(?:el\s+|un\s+)?(?:ideal|perfecto|mejor))\b/,
  },
];

/** Letras de otros alfabetos que se leen como ASCII (sobre texto ya plegado a minúsculas). */
const CONFUSABLES: Readonly<Record<string, string>> = {
  а: "a",
  е: "e",
  о: "o",
  р: "p",
  с: "c",
  х: "x",
  у: "y",
  і: "i",
  ј: "j",
  ѕ: "s",
  к: "k",
  м: "m",
  н: "h",
  т: "t",
  ԁ: "d",
  һ: "h",
  ӏ: "l",
  ԛ: "q",
  ѡ: "w",
  α: "a",
  ο: "o",
  ν: "v",
  ι: "i",
  τ: "t",
  ρ: "p",
  ε: "e",
  κ: "k",
  υ: "u",
  χ: "x",
  γ: "y",
  η: "n",
  β: "b",
  ω: "w",
  ı: "i",
};

const LEET: Readonly<Record<string, string>> = {
  "0": "o",
  "1": "i",
  "3": "e",
  "4": "a",
  "5": "s",
  "7": "t",
  "@": "a",
  $: "s",
};

const mapConfusables = (text: string): string =>
  Array.from(text, (ch) => CONFUSABLES[ch] ?? ch).join("");

/** Une las rachas de tres o más letras sueltas dentro de un trozo ya separado en palabras. */
function joinSingleLetters(chunk: string): string {
  const out: string[] = [];
  let run: string[] = [];
  const flush = () => {
    if (run.length >= 3) out.push(run.join(""));
    else out.push(...run);
    run = [];
  };
  for (const t of chunk.split(/\s+/)) {
    if (/^[a-z]$/.test(t)) run.push(t);
    else {
      flush();
      out.push(t);
    }
  }
  flush();
  return out.join(" ");
}

/**
 * Separadores entre palabras o letras → espacio; tres o más letras sueltas seguidas se pegan.
 * Con `keepBoundaries`, dos o más espacios seguidos cuentan como límite de palabra y no se pegan
 * letras de un lado y del otro ("i g n o r e  p r e v i o u s").
 */
function unsplit(text: string, keepBoundaries: boolean): string {
  const spaced = text.replace(/[-_.*·|/\\]+/g, " ");
  const chunks = keepBoundaries ? spaced.split(/\s{2,}/) : [spaced];
  return chunks.map(joinSingleLetters).join(" ");
}

/** Cifras y símbolos por letras, solo dentro de palabras que ya traen letras ("1gnore"). */
const unleet = (text: string): string =>
  text
    .split(/\s+/)
    .map((t) =>
      /[a-z]/.test(t) && /[0-9@$]/.test(t) ? Array.from(t, (c) => LEET[c] ?? c).join("") : t,
    )
    .join(" ");

/** Tope de caracteres que se revisan: el prompt del evaluador toma como máximo 60.000 de la JD. */
export const INJECTION_SCAN_MAX_CHARS = 100_000;
/** Cuántas coincidencias de un patrón con condición extra se examinan (acota el costo). */
const MAX_CHECKED_MATCHES = 50;

/** Caracteres de etiqueta (U+E0000–E007F): codifican texto que la persona no ve. */
const TAG_CHARS_RE = /[\u{E0000}-\u{E007F}]/u;
/** Caracteres de formato (\p{Cf}: ancho cero, marcas de dirección, guion blando, BOM…) y selectores de variación. */
const FORMAT_CHARS_RE = /[\p{Cf}︀-️\u{E0100}-\u{E01EF}]/gu;

/** ¿Salta el patrón en este texto? Con condición extra, mira cada coincidencia (hasta un tope). */
function patternHits(p: Pattern, text: string): boolean {
  if (!p.needs) return p.re.test(text);
  const re = new RegExp(p.re.source, "g");
  let checked = 0;
  for (const m of text.matchAll(re)) {
    if (checked++ >= MAX_CHECKED_MATCHES) break;
    const start = m.index ?? 0;
    const scope =
      p.needs.scope === "match"
        ? m[0]
        : text.slice(Math.max(0, start - 100), start + m[0].length + 100);
    if (p.needs.re.test(scope)) return true;
  }
  return false;
}

/**
 * Detecta texto dirigido al modelo evaluador dentro de un aviso. Devuelve los NOMBRES de los
 * patrones que saltaron, nunca el texto: el aviso es contenido de terceros. Revisa como máximo
 * `INJECTION_SCAN_MAX_CHARS` caracteres, con costo lineal.
 */
export function detectEvaluatorInjection(text: string): { hit: boolean; signals: string[] } {
  const hidden = TAG_CHARS_RE.test(text);
  // Los invisibles pueden rellenar: se mira un tramo del doble del tope antes de quitarlos
  const head = text.slice(0, INJECTION_SCAN_MAX_CHARS * 2);
  const noFormat = head.replace(FORMAT_CHARS_RE, "");
  const stripped = noFormat.slice(0, INJECTION_SCAN_MAX_CHARS);
  const bases = [stripped];
  // Un invisible entre palabras también puede ser el separador: se prueba además como espacio
  if (noFormat.length !== head.length) {
    bases.push(head.slice(0, INJECTION_SCAN_MAX_CHARS).replace(FORMAT_CHARS_RE, " "));
  }
  const variants = new Set<string>();
  for (const base of bases) {
    const folded = mapConfusables(foldText(base));
    // Cada patrón se prueba sobre el texto plegado y sobre sus variantes sin separadores ni cifras
    const spaced = unsplit(folded, true);
    const spacedAll = unsplit(folded, false);
    for (const v of [folded, spaced, spacedAll, unleet(spaced), unleet(spacedAll)]) variants.add(v);
  }
  const list = [...variants];
  const signals = PATTERNS.filter((p) => list.some((v) => patternHits(p, v))).map((p) => p.name);
  if (hidden) signals.push("texto_oculto");
  return { hit: signals.length > 0, signals };
}

/**
 * Revisa todo lo que `renderJob` pone en el prompt (título, empresa, ubicación, contrato, sueldo,
 * etiquetas y JD), sin las marcas del aviso. Mismo largo acotado que el prompt.
 */
export function detectJobInjection(job: JobForPrompt): { hit: boolean; signals: string[] } {
  return detectEvaluatorInjection(renderJob(job));
}
