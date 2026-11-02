/**
 * Saludo del encabezado de «Hoy» (C7-7, manual P2): según la hora en la zona del perfil. Función
 * pura: la hora y la zona entran como parámetros.
 */
const FALLBACK_TZ = "America/Argentina/Buenos_Aires";

function hourIn(now: Date, timeZone: string): number {
  const format = (tz: string) =>
    new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: tz }).format(
      now,
    );
  let text: string;
  try {
    text = format(timeZone);
  } catch {
    text = format(FALLBACK_TZ);
  }
  return Number(text) % 24;
}

export function greeting(
  now: Date,
  timeZone: string,
): "Buen día" | "Buenas tardes" | "Buenas noches" {
  const hour = hourIn(now, timeZone);
  if (hour >= 5 && hour < 12) return "Buen día";
  if (hour >= 12 && hour < 20) return "Buenas tardes";
  return "Buenas noches";
}

/** Primer nombre para el saludo; null si no hay. Corta a 40 caracteres. */
export function firstName(displayName: string | null): string | null {
  const first = (displayName ?? "").trim().split(/\s+/)[0] ?? "";
  return first ? first.slice(0, 40) : null;
}
