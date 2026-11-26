/** Largo máximo de una URL que se acepta para «Ir al aviso». */
const MAX_URL = 2048;

/**
 * Enlace externo seguro: solo `https:`, sin usuario ni contraseña. Cualquier otra cosa (http, javascript:,
 * data:, texto raro) devuelve null y no se muestra el botón. La URL sale de un aviso, o sea de afuera.
 */
export function httpsUrl(url: string | null | undefined): string | null {
  if (!url || url.length > MAX_URL) return null;
  try {
    const u = new URL(url.trim());
    if (u.protocol !== "https:" || u.username || u.password) return null;
    return u.href;
  } catch {
    return null;
  }
}

export type ChecklistItem = { key: string; text: string };

/**
 * Checklist para antes de postular. Los primeros ítems cambian según lo que ya hay preparado; los
 * últimos valen siempre. Es una guía: la app no sabe qué pide el sitio de la empresa.
 */
export function postularChecklist(state: {
  hasAnswers: boolean;
  hasCover: boolean;
}): ChecklistItem[] {
  return [
    {
      key: "cv",
      text: "Abrí tu CV y revisá que cuente lo que esta oferta pide.",
    },
    state.hasAnswers
      ? { key: "answers", text: "Leé tus respuestas guardadas y ajustalas a tu manera." }
      : {
          key: "answers",
          text: "Si el formulario tiene preguntas, pegalas en la oferta para armar borradores.",
        },
    state.hasCover
      ? { key: "cover", text: "Releé tu carta: tiene que sonar a vos." }
      : { key: "cover", text: "Si el sitio pide carta, escribila con tus palabras." },
    { key: "portal", text: "Completá y enviá la postulación en el sitio del aviso." },
    {
      key: "mark",
      text: "Volvé y marcá «Ya me postulé»: la app no puede ver si te postulaste.",
    },
  ];
}
