/**
 * Preguntas del chat de CV (C-25). El temario lo decide el código (`nextCvTopic`); la pregunta de cada
 * tema también es una plantilla fija: el modelo no elige qué se pregunta ni lo reformula, solo extrae la
 * respuesta y suma un acuse corto. Así una pregunta nunca depende de una salida de LLM.
 */
import { cvConflictLabel, type CvConflict } from "./conflicts";
import type { CvChatState, CvTopic } from "./state";

const orgOf = (s: CvChatState, i: number | null): string => {
  const o = i === null ? null : s.works[i]?.organization;
  return o ? ` en ${o}` : "";
};

/**
 * «¿Cuál dejo?» (R12-3): plantilla fija con las dos opciones, sin texto del modelo. Contra el historial
 * confirmado: «En tu CV figura…»; contra lo dicho antes en la charla: «Antes me dijiste…».
 */
export function cvConflictQuestion(c: CvConflict): string {
  const show = (v: string): string =>
    c.field === "title" ? `«${cvConflictLabel(c.field, v)}»` : cvConflictLabel(c.field, v);
  return c.source === "confirmed"
    ? `En tu CV figura ${show(c.previous)}, acá me decís ${show(c.proposed)}. ¿Cuál dejo?`
    : `Antes me dijiste ${show(c.previous)}, ahora me decís ${show(c.proposed)}. ¿Cuál dejo?`;
}

/** Texto de la pregunta para un tema, con el contexto del trabajo si lo hay. */
export function cvTopicQuestion(topic: CvTopic, s: CvChatState): string {
  // Contradicción pendiente (R12-3): va antes que cualquier tema
  if (s.conflict) return cvConflictQuestion(s.conflict);
  // Repregunta vigente (R4-16): texto ya validado por el código (`resolveCvFollowUp`)
  if (s.followUp && s.followUp.key === topic.key) return s.followUp.question;
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
      // R33 (C-62): «¿Es tu trabajo actual?» llena «Actualidad»; si ya no, se pide hasta cuándo
      return `¿Desde cuándo trabajaste${at}? ¿Es tu trabajo actual? Si ya no, decime hasta cuándo.`;
    case "duties":
      return `¿Qué hacías${at}? Contame las tareas principales, de una a cuatro.`;
    case "achievement":
      return `¿Cuál fue un logro concreto${at}? Si tenés un número, mejor. Si no se te ocurre, podés saltearlo.`;
    case "more_work":
      return "¿Querés sumar otro trabajo anterior?";
    case "education":
      // R33-03 (C-14): sin experiencia no es haber «fallado»: se ofrece el camino de proyectos, estudios, voluntariado y cursos
      return s.guided && s.works.length === 0 && s.workDone
        ? "Está bien, hay otros caminos para mostrar lo que sabés. Contame tus estudios (institución, título y años). Después podés sumar proyectos, voluntariado o cursos."
        : "¿Qué estudios tenés? Institución, título y años. Si no tenés, decímelo.";
    case "summary_experience":
      return "¿Hace cuánto trabajás en esto y en qué áreas?";
    case "summary_goal":
      return "¿Qué te gustaría hacer en tu próximo trabajo? Podés contarme el tipo de empresa o de equipo.";
    case "summary_strengths":
      return "¿Qué dos o tres cosas hacés bien en tu trabajo?";
    case "soft_lead":
      return "¿Alguna vez coordinaste personas o capacitaste a alguien? Contame cómo fue. Si no, podés saltearla.";
    case "soft_problem":
      return "¿Qué problema resolviste en tu último trabajo y cómo? Si no se te ocurre, podés saltearla.";
    case "soft_clients":
      return "¿Trabajaste con clientes u otras áreas? ¿Cómo? Si no, podés saltearla.";
    case "soft_organize":
      return "¿Algo que hayas organizado o mejorado? Si no, podés saltearla.";
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
