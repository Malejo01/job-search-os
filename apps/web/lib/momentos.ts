/**
 * Lógica pura de los momentos de la mascota (R27-04). Sin I/O: la leen componentes de servidor y de
 * cliente, y la prueba `test/momentos.test.ts`.
 */

/** Día (AAAA-MM-DD) de `d` en la zona horaria `timeZone` (la de la persona). Zona inválida: UTC. */
export function dayKeyIn(d: Date, timeZone: string): string {
  const format = (tz: string) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  try {
    return format(timeZone);
  } catch {
    return format("UTC");
  }
}

/** Forma válida de un día guardado: así la cuenta no recibe cualquier texto del navegador. */
export function esDiaValido(day: unknown): day is string {
  return typeof day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(day);
}

/**
 * Hoy saluda una vez por día. Se saluda si ni la cuenta ni este navegador tienen anotado el día de hoy:
 * la cuenta evita repetir en otro dispositivo; el navegador cubre el caso en que la cuenta no se pudo
 * leer o guardar (sin perfil todavía, o columna que aún no existe).
 */
export function debeSaludar(
  cuenta: string | null,
  navegador: string | null,
  today: string,
): boolean {
  return cuenta !== today && navegador !== today;
}

/** Los logros que se festejan. Los textos viven acá para que el componente no tenga copias. */
export const FESTEJOS = ["postulacion", "cv", "plan"] as const;
export type Festejo = (typeof FESTEJOS)[number];

export const FESTEJO_TEXTOS: Readonly<Record<Festejo, { titulo: string; detalle: string }>> = {
  postulacion: {
    titulo: "¡Postulación enviada!",
    detalle: "Un paso más. Cuando te contesten, cargalo en tus postulaciones.",
  },
  cv: {
    titulo: "¡Tu CV quedó mejor!",
    detalle: "Ya lo podés usar en tus próximas postulaciones.",
  },
  plan: {
    titulo: "¡Arrancaste tu plan!",
    detalle: "Cada skill que cerrás suma a tus ofertas.",
  },
};

/** Cuánto dura el aviso antes de irse solo (ms). */
export const FESTEJO_DURACION_MS = 7000;

/**
 * Un festejo corresponde solo cuando el logro pasó de «no» a «sí» mientras la pantalla estaba abierta.
 * Con el logro ya cumplido al entrar (`anterior` null: primera lectura) no se festeja, y recargar tampoco
 * lo repite porque la primera lectura vuelve a ser la inicial.
 */
export function festejoCorresponde(anterior: boolean | null, ahora: boolean): boolean {
  return anterior === false && ahora;
}

/** Clave de `sessionStorage` para el festejo que se dispara al llegar a una pantalla (el CV con el coach). */
export function festejoClave(festejo: Festejo): string {
  return `afinia:festejo:${festejo}`;
}
