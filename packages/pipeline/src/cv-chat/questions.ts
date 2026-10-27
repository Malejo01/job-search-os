/**
 * Preguntas del chat de CV (C-25). El temario lo decide el código (`nextCvTopic`); la pregunta de cada
 * tema también es una plantilla fija: el modelo no elige qué se pregunta ni lo reformula, solo extrae la
 * respuesta y suma un acuse corto. Así una pregunta nunca depende de una salida de LLM.
 */
import type { CvChatState, CvTopic } from "./state";

const orgOf = (s: CvChatState, i: number | null): string => {
  const o = i === null ? null : s.works[i]?.organization;
  return o ? ` en ${o}` : "";
};

/** Texto de la pregunta para un tema, con el contexto del trabajo si lo hay. */
export function cvTopicQuestion(topic: CvTopic, s: CvChatState): string {
  const at = orgOf(s, topic.workIndex);
  switch (topic.kind) {
    case "target":
      return "¿A qué puesto querés apuntar con este CV?";
    case "organization":
      return topic.workIndex === 0
        ? "Empecemos por tu experiencia. ¿En qué empresa trabajaste (la más reciente)? Si todavía no tenés experiencia laboral, decímelo."
        : "¿En qué empresa fue ese trabajo?";
    case "title":
      return `¿Qué cargo tenías${at}?`;
    case "dates":
      return `¿Desde cuándo y hasta cuándo trabajaste${at}? Si seguís ahí, decímelo.`;
    case "duties":
      return `¿Qué hacías${at}? Contame las tareas principales, de una a cuatro.`;
    case "achievement":
      return `¿Cuál fue un logro concreto${at}? Si tenés un número, mejor. Si no se te ocurre, podés saltearlo.`;
    case "more_work":
      return "¿Querés sumar otro trabajo anterior?";
    case "education":
      return "¿Qué estudios tenés? Institución, título y años. Si no tenés, decímelo.";
    case "certifications":
      return "¿Tenés certificaciones o cursos que quieras incluir? Si no, decímelo.";
    case "skills":
      return "¿Qué herramientas o tecnologías manejás? Listalas separadas por coma.";
    case "languages":
      return "¿Qué idiomas hablás y con qué nivel?";
    case "links":
      return "¿Querés incluir links (LinkedIn, GitHub, portfolio)? Pegalos acá o decime que no.";
  }
}
