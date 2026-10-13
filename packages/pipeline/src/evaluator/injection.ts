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
];

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
  const folded = foldText(visible);
  const signals = PATTERNS.filter((p) => p.re.test(folded)).map((p) => p.name);
  if (hidden) signals.push("texto_oculto");
  return { hit: signals.length > 0, signals };
}
