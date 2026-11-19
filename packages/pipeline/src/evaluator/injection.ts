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
const PATTERNS: readonly { name: string; re: RegExp }[] = [
  {
    name: "ignorar_instrucciones",
    re: /\bignor(?:a|e)\s+(?:todas\s+)?(?:las\s+)?(?:instrucciones|reglas)\s+(?:anteriores|previas|del sistema)/,
  },
  {
    name: "ignore_previous",
    re: /\bignore\s+(?:all\s+)?(?:the\s+)?(?:previous|prior|above)\s+(?:instructions|rules)/,
  },
  { name: "system_prompt", re: /\bsystem\s+prompt\b/ },
  { name: "you_are_now", re: /\byou\s+are\s+now\s+(?:a|an)\b/ },
  { name: "act_as_ai", re: /\bact\s+as\s+(?:a|an)\s+(?:ai|assistant|language model)\b/ },
  {
    name: "disregard_previous",
    re: /\b(?:disregard|forget)\s+(?:all\s+)?(?:the\s+)?(?:previous|prior|above)\s+(?:instructions|rules)/,
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
    re: /\b(?:ignor(?:a|e|ar)|descart(?:a|e|ar)|desestim(?:a|e|ar)|omit(?:e|ir)|saltea(?:te)?|desatend(?:e|er))\s+(?:(?:todas?|todo|el|la|las|los|lo|as|os)\s+){0,2}(?:(?:instruc\w*|reglas?|regras|indicaciones)\s+(?:anteriores|previas|previos)|(?:lo\s+)?(?:indicado|anterior|escrito)\b)/,
  },
  {
    name: "pasar_por_alto",
    re: /\bpasa(?:r)?\s+por\s+alto\s+(?:todo\s+)?(?:lo\s+)?(?:indicado|anterior|escrito|dicho)/,
  },
  {
    name: "mandato_nota",
    re: /\b(?:pone|poner|ponele|asigna|asignale|asignar|dale|califica|calificalo|calificar|puntua|otorga|otorgale|give|assign|rate|grade|set)\b(?:\W+\w+){0,4}?\W+(?:nota|score|puntaje|puntuacion|calificacion|rating|grade)\b(?:\W+(?:de|of|a|to|as|como))?\W+(?:maxim[ao]|alt[ao]|perfect[ao]?|max|maximum|highest|top|diez|ten|10|9|excelente)\b/,
  },
  {
    name: "mandato_nota_maxima",
    re: /\b(?:pone|poner|ponele|asigna|asignale|asignar|dale|califica|calificalo|calificar|puntua|otorga|otorgale|give|assign|rate|grade|set)\b(?:\W+\w+){0,3}?\W+(?:maxim[ao]|maximum|highest|top|perfect[ao]?|alt[ao]|high|diez|ten)\s+(?:nota|score|puntaje|puntuacion|calificacion|rating|grade)\b/,
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
    re: /\b(?:this\s+(?:candidate|applicant)\s+is\s+(?:a\s+|an\s+|the\s+)?(?:perfect|ideal|best|top)|este\s+(?:candidato|perfil|postulante)\s+es\s+(?:el\s+|un\s+)?(?:ideal|perfecto|mejor))\b/,
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

/** Separadores entre palabras o letras → espacio; tres o más letras sueltas seguidas se pegan. */
function unsplit(text: string): string {
  const tokens = text.replace(/[-_.*·|/\\]+/g, " ").split(/\s+/);
  const out: string[] = [];
  let run: string[] = [];
  const flush = () => {
    if (run.length >= 3) out.push(run.join(""));
    else out.push(...run);
    run = [];
  };
  for (const t of tokens) {
    if (/^[a-z]$/.test(t)) run.push(t);
    else {
      flush();
      out.push(t);
    }
  }
  flush();
  return out.join(" ");
}

/** Cifras y símbolos por letras, solo dentro de palabras que ya traen letras ("1gnore"). */
const unleet = (text: string): string =>
  text
    .split(/\s+/)
    .map((t) =>
      /[a-z]/.test(t) && /[0-9@$]/.test(t) ? Array.from(t, (c) => LEET[c] ?? c).join("") : t,
    )
    .join(" ");

/** Caracteres de etiqueta (U+E0000–E007F): codifican texto que la persona no ve. */
const isTagChar = (code: number): boolean => code >= 0xe0000 && code <= 0xe007f;

/** Invisibles que partirían una frase para esquivar los patrones (ancho cero, guion blando, BOM). */
const isInvisible = (code: number): boolean =>
  (code >= 0x200b && code <= 0x200d) ||
  code === 0x00ad ||
  (code >= 0x2060 && code <= 0x2064) ||
  code === 0xfeff ||
  isTagChar(code);

/**
 * Detecta texto dirigido al modelo evaluador dentro de un aviso. Devuelve los NOMBRES de los
 * patrones que saltaron, nunca el texto: el aviso es contenido de terceros.
 */
export function detectEvaluatorInjection(text: string): { hit: boolean; signals: string[] } {
  const hidden = Array.from(text).some((ch) => isTagChar(ch.codePointAt(0) ?? 0));
  const visible = Array.from(text)
    .filter((ch) => !isInvisible(ch.codePointAt(0) ?? 0))
    .join("");
  const folded = mapConfusables(foldText(visible));
  const spaced = unsplit(folded);
  // Cada patrón se prueba sobre el texto plegado y sobre sus variantes sin separadores ni cifras
  const variants = [folded, spaced, unleet(spaced)];
  const signals = PATTERNS.filter((p) => variants.some((v) => p.re.test(v))).map((p) => p.name);
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
