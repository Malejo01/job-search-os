import { decidirPublicacion, type MotivoPublicacion } from "@job-search-os/pipeline";
import type { AcademyFicha } from "./academy";
import type { ReviewRow } from "./academy-revisiones";

/**
 * Textos de la pantalla de revisión de Academy (R26-01). En un archivo propio: no son de los textos del
 * rediseño que aprueba quien define la marca.
 */
export const ACADEMY_REVISION = {
  titulo: "Revisar Academy",
  intro:
    "Acá se ven todas las fichas, también las que siguen en borrador. Si aprobás una, se publica en Academy y en sus «?» con este contenido exacto. Si después alguien cambia el texto de la ficha, la aprobación deja de valer y vuelve a borrador hasta que la revises de nuevo.",
  aprobar: "Aprobar",
  pedirCambios: "Pedir cambios",
  comentarioLabel: "¿Qué hay que cambiar?",
  comentarioAyuda: "Hasta 500 caracteres. Se guarda en el historial; no cambia la ficha.",
  sinLectura:
    "No pudimos leer las revisiones. Podés leer las fichas, pero para aprobar tu cuenta necesita el rol de tester (se lo da quien administra, en Personas).",
  historialTitulo: "Historial",
  historialVacio: "Todavía nadie revisó una ficha desde la app.",
} as const;

/**
 * Cómo se nombra a quien revisó en el historial (R28-10). Un admin ve el email; un tester ve «Vos» en lo suyo y
 * «Otra persona del equipo» en lo de los demás: el email de otra cuenta no se muestra a quien no administra.
 * Una cuenta borrada (sin email) se dice igual para todos.
 */
export function nombreDelRevisor(input: {
  reviewerEmail: string | null;
  viewerEmail: string | null;
  viewerIsAdmin: boolean;
}): string {
  if (!input.reviewerEmail) return "Cuenta borrada";
  if (input.viewerIsAdmin) return input.reviewerEmail;
  const mine =
    input.viewerEmail !== null &&
    input.viewerEmail.trim().toLowerCase() === input.reviewerEmail.trim().toLowerCase();
  return mine ? "Vos" : "Otra persona del equipo";
}

/** Textos de la revisión de los textos del rediseño (R26-02), en `/admin/textos` y `/settings/textos`. */
export const TEXTOS_APROBACION = {
  titulo: "Textos del rediseño",
  introAdmin:
    "Cada texto que todavía puede cambiar la marca. «Aprobar» deja constancia de que ese texto, tal como está hoy, está bien. «Proponer otro» guarda una sugerencia: no cambia la app, queda en «Propuestas de Ani» para pasarla al código. Si el texto del código cambia, la aprobación vieja deja de valer.",
  introTester:
    "Mirá cada texto tal como se ve en la app. Si está bien, aprobalo; si preferís otro, proponelo. Tu propuesta no cambia la app: la ve quien administra y la pasa al código.",
  aprobar: "Aprobar",
  proponer: "Proponer otro",
  propuestaLabel: "Tu texto",
  propuestaAyuda: "Hasta 1000 caracteres. No cambia la app.",
  enviarPropuesta: "Guardar propuesta",
  sinLectura:
    "No pudimos leer las revisiones. Podés leer los textos, pero para aprobar o proponer tu cuenta necesita el rol de tester (se lo da quien administra, en Personas).",
  resumen: (aprobados: number, total: number) => `${aprobados} de ${total} aprobados`,
  propuestasTitulo: "Propuestas de Ani",
  propuestasVacia: "Todavía no hay propuestas.",
  propuestasAyuda:
    "Lo último que se dijo de cada texto es una propuesta. «Copiar» copia el texto propuesto para pegarlo en `apps/web/lib/textos-rediseno.ts`. Nada se cambia solo.",
  copiar: "Copiar",
  copiado: "Copiado",
  propuestaVieja: "El texto del código cambió desde entonces: puede que ya esté aplicada.",
  actual: "Hoy dice",
  historialTitulo: "Historial de textos",
  historialVacio: "Todavía nadie revisó un texto desde la app.",
  verTextos: "Ver los textos para aprobar",
} as const;

export const TEXTO_ESTADO_LABEL = {
  sin_revisar: "Sin revisar",
  aprobado: "Aprobado",
  cambio_el_codigo: "Cambió el texto",
  propuesta: "Propuesta guardada",
  propuesta_vieja: "Propuesta anterior",
} as const;

export const TEXTO_ESTADO_DETALLE = {
  sin_revisar: "Todavía nadie lo revisó.",
  aprobado: "Aprobado con el texto de hoy.",
  cambio_el_codigo: "Se aprobó, pero el texto cambió después: hay que revisarlo de nuevo.",
  propuesta: "Se propuso otro texto; este sigue sin aprobar.",
  propuesta_vieja: "Había una propuesta, pero el texto cambió después.",
} as const;

/** La etiqueta y la ayuda del estado de una ficha, según el archivo y lo último que dijo quien revisa. */
export function estadoDeRevision(
  ficha: Pick<AcademyFicha, "estado" | "huella">,
  ultima: Pick<ReviewRow, "status" | "contentHash"> | null,
): { etiqueta: "Aprobada" | "Borrador"; detalle: string; motivo: MotivoPublicacion } {
  const { publicada, motivo } = decidirPublicacion({
    archivoEstado: ficha.estado,
    huellaActual: ficha.huella,
    revision: ultima ? { estado: ultima.status, huella: ultima.contentHash } : null,
  });
  const detalle: Record<MotivoPublicacion, string> = {
    archivo: "Aprobada en el archivo del repo.",
    aprobada_en_base: "Aprobada desde la app. Se ve en Academy.",
    sin_revision: "Sin revisar.",
    cambios_pedidos: "Se pidieron cambios.",
    huella_distinta: "Se aprobó, pero el texto cambió después: hay que revisarla de nuevo.",
    huella_invalida: "No se pudo comprobar el contenido: queda en borrador.",
  };
  return { etiqueta: publicada ? "Aprobada" : "Borrador", detalle: detalle[motivo], motivo };
}
