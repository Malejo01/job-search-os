/** Textos y cuentas de la UI de voz (R25-02), sin React para poder probarlos. */

export const VOICE_BAR_COUNT = 7;

export const VOICE_PRIVACY_BROWSER =
  "El navegador puede mandar el audio a su proveedor para transcribirlo; nosotros no lo grabamos ni lo guardamos.";

export const VOICE_PRIVACY_SERVER =
  "Tu voz se graba en este navegador, se manda a nuestro servidor y a Google (Gemini) para pasarla a texto, y se descarta al terminar: no la guardamos.";

/** Aviso de privacidad según el camino que se usa (o se va a usar) y si hay respaldo en el servidor. */
export function voicePrivacyNote(
  mode: "browser" | "record" | null,
  serverTranscribe: boolean,
): string {
  if (mode === "record") return VOICE_PRIVACY_SERVER;
  if (mode === "browser" && serverTranscribe) {
    return `${VOICE_PRIVACY_BROWSER} Si el dictado del navegador no anda, grabamos tu voz y la transcribimos en el servidor con Google (Gemini); se descarta al terminar.`;
  }
  return VOICE_PRIVACY_BROWSER;
}

/** `m:ss` para el contador. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Escala vertical (0.12..1) de una barra para un nivel 0..1: casi plana en silencio. */
export function barScale(level: number): number {
  const v = Math.min(1, Math.max(0, level) * 1.6);
  return 0.12 + v * 0.88;
}

/** Nivel 0..1 a un número 0..9 para el modo de movimiento reducido. */
export function levelDigit(level: number): number {
  return Math.min(9, Math.round(Math.min(1, Math.max(0, level) * 1.6) * 9));
}
