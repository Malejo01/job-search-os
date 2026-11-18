import type { CvCoachAnswer, CvIssue } from "@job-search-os/pipeline";
import type { CvCoachFixture } from "./golden";

/**
 * La persona de las charlas del golden (R12-13, plan §5.1): **código, no un modelo**. No suma costo y es
 * repetible. Responde con lo que guiona la fixture para el tipo de problema y el ítem (o la skill); lo que
 * no está guionado es «no tengo». A una repregunta responde con la respuesta siguiente de la lista, o «no
 * tengo» si no hay más.
 */
export const PERSONA_DECLINE = "no tengo";

/** Clave con la que la fixture guiona un problema: la del ítem, o el slug de la skill. */
export function issueScriptKey(issue: CvIssue, f: CvCoachFixture): string | null {
  if (issue.skillSlug) return issue.skillSlug;
  if (issue.ref.itemId === null) return null;
  return f.lectura.items.find((i) => i.id === issue.ref.itemId)?.clave ?? null;
}

/** Texto que diría la persona; `attempt` 0 es la primera pregunta del problema, 1 y 2 las repreguntas. */
export function personaText(f: CvCoachFixture, issue: CvIssue, attempt: number): string {
  const byKey = f.respuestas[issue.type];
  if (!byKey) return PERSONA_DECLINE;
  const key = issueScriptKey(issue, f);
  const scripted = (key !== null ? byKey[key] : undefined) ?? byKey["*"];
  if (scripted === undefined) return PERSONA_DECLINE;
  const list = Array.isArray(scripted) ? scripted : [scripted];
  return list[attempt] ?? PERSONA_DECLINE;
}

/** La respuesta como la manda el navegador: «no tengo» es el botón; el resto, texto libre. */
export function personaAnswer(f: CvCoachFixture, issue: CvIssue, attempt: number): CvCoachAnswer {
  const text = personaText(f, issue, attempt);
  if (text.trim().toLowerCase() === PERSONA_DECLINE) return { kind: "none", issueId: issue.id };
  return { kind: "text", issueId: issue.id, text };
}
