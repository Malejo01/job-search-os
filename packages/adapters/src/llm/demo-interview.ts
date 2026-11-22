/**
 * Fakes de `LLM_DEMO` para el simulador de entrevistas (`interview_questions` e `interview_feedback`). No llaman
 * a ningún modelo: devuelven algo coherente con el esquema y determinista, para recorrer el flujo en los e2e
 * sin gasto. La heurística es deliberadamente simple (largo y palabras de la respuesta) y no reemplaza al modelo.
 */
type Vars = Record<string, string | number | boolean>;

const between = (text: string, open: string, close: string): string => {
  const start = text.indexOf(open);
  if (start < 0) return "";
  const from = start + open.length;
  const end = text.indexOf(close, from);
  return (end < 0 ? text.slice(from) : text.slice(from, end)).trim();
};

const lineValue = (block: string, label: string): string =>
  new RegExp(`^${label}: (.+)$`, "m").exec(block)?.[1]?.trim() ?? "";

/** Cinco preguntas inventadas sobre el puesto o la carrera que figure en el contexto. */
export function demoInterviewQuestions(vars: Vars): Record<string, unknown> {
  const context = between(String(vars.context ?? ""), "<<<CONTEXTO>>>", "<<<FIN CONTEXTO>>>");
  const role = lineValue(context, "Puesto") || lineValue(context, "Carrera") || "este puesto";
  return {
    questions: [
      `DEMO: contame una situación en la que resolviste un problema complejo como ${role}.`,
      `DEMO: ¿cómo organizás tu trabajo cuando tenés varias prioridades a la vez en ${role}?`,
      `DEMO: contame un error que cometiste y qué hiciste para corregirlo.`,
      `DEMO: ¿cómo resolverías un pedido urgente que pisa otro compromiso en ${role}?`,
      `DEMO: ¿qué te motiva a trabajar en equipo y cómo lo hacés?`,
    ],
  };
}

const has = (text: string, ...words: string[]): boolean => {
  const folded = text.toLowerCase();
  return words.some((w) => folded.includes(w));
};

/** Devolución falsa: puntúa por largo y por señales de situación, acción y resultado. */
export function demoInterviewFeedback(vars: Vars): Record<string, unknown> {
  const answer = between(String(vars.answer ?? ""), "<<<RESPUESTA>>>", "<<<FIN RESPUESTA>>>");
  const situation = has(answer, "cuando", "en mi ", "situación", "proyecto");
  const action = has(answer, "hice", "armé", "implementé", "lideré", "resolví", "propuse");
  const result = has(answer, "resultado", "logré", "redujo", "mejoró", "%") || /\d/.test(answer);
  const clarity = Math.min(9, 3 + Math.floor(answer.length / 60));
  const relevance = answer.length < 40 ? 5 : 7;
  const star = Math.min(9, 2 + [situation, action, result].filter(Boolean).length * 2);
  return {
    clarity,
    relevance,
    star,
    tip: result
      ? "DEMO: buen cierre. Sumá una línea sobre qué aprendiste para que la respuesta quede completa."
      : "DEMO: cerrá con el resultado de lo que hiciste, de preferencia con un número o un antes y después.",
    example:
      "DEMO: En mi último proyecto [situación], me tocó [tarea]; hice [acción] y logré [resultado con un número].",
  };
}
