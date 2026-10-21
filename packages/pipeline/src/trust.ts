import { fillLegalPlaceholders, LEGAL_PENDING_TEXT } from "./legal/fill";

/**
 * Recuadro de confianza (ronda 39): qué lee la app, qué no, cómo cortarlo y quién está detrás.
 * Textos en llano y testeables; la web los muestra y completa `{responsable}`. Puro, sin I/O.
 */

export type TrustText = {
  id: "lee" | "no_lee" | "cortar" | "responsable";
  title: string;
  body: string;
};

/** Marcador que la web reemplaza por el responsable (ver `trustResponsable`). */
export const TRUST_RESPONSABLE_PLACEHOLDER = "{responsable}";

/** Lo que se muestra si la variable del responsable no está cargada. */
export const TRUST_RESPONSABLE_FALLBACK = "un responsable en revisión";

export const TRUST_TEXTS: readonly [TrustText, TrustText, TrustText, TrustText] = [
  {
    id: "lee",
    title: "Qué leemos",
    body: "Solo los emails que llegan a tu dirección personal de ingesta (los que tu filtro de Gmail reenvía) y las ofertas públicas de las fuentes que mostramos.",
  },
  {
    id: "no_lee",
    title: "Qué no leemos",
    body: "No leemos el resto de tu bandeja, ni tus contraseñas ni tus contactos. No tenemos acceso a tu cuenta de Gmail.",
  },
  {
    id: "cortar",
    title: "Cómo cortarlo",
    body: "Borrá el filtro en Gmail, o borrá tu cuenta acá y se borra todo lo tuyo de nuestra base (qué queda afuera está en la política de privacidad).",
  },
  {
    id: "responsable",
    title: "Quién está detrás",
    body: `Detrás de este servicio está ${TRUST_RESPONSABLE_PLACEHOLDER}. Cómo tratamos tus datos está en la política de privacidad.`,
  },
];

/**
 * Nombre del responsable a partir de `LEGAL_RESPONSABLE`: mismo helper y mismas reglas que las
 * páginas legales (sin formato invisible, tope de largo). Si falta o no sirve, un texto neutro.
 */
export function trustResponsable(raw: string | undefined): string {
  const filled = fillLegalPlaceholders("[RESPONSABLE]", { LEGAL_RESPONSABLE: raw });
  if (filled === LEGAL_PENDING_TEXT) return TRUST_RESPONSABLE_FALLBACK;
  // fillLegalPlaceholders escapa el markdown; acá el valor se muestra como texto plano
  return filled.replace(/\\([\\`*[\]()|])/g, "$1");
}

/** El cuerpo con `{responsable}` reemplazado. Un `$` en el valor no se interpreta. */
export function fillTrustBody(body: string, responsable: string): string {
  return body.split(TRUST_RESPONSABLE_PLACEHOLDER).join(responsable);
}
