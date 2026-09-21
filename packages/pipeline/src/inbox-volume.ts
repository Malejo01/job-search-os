/**
 * Volumen de emails entrantes (JS-038). Decide si /inbox tiene que avisar que algo raro pasa:
 * un filtro de reenvío de Gmail que manda todo el correo (banco, GitHub…), un pico que llena la
 * base, o emails perdidos por el límite de 100/hora del webhook. Puro: recibe conteos.
 */
export type InboxVolumeInput = {
  /** Emails recibidos en las últimas 24 h. */
  last24h: number;
  /** De esos, cuántos no tenían parser (cola manual). */
  last24hNoParser: number;
  /** Emails rechazados por el límite horario en las últimas 24 h (no se guardaron). */
  rejectedLast24h: number;
  /** Recibidos por día en los 7 días anteriores (sin contar las últimas 24 h). */
  previousDays: readonly number[];
};

export type InboxVolume = {
  level: "ok" | "alto";
  reasons: string[];
  averagePerDay: number;
};

export type InboxVolumeOptions = {
  /** Cuántas veces el promedio diario cuenta como pico. */
  spikeFactor?: number;
  /** Mínimo absoluto en 24 h para hablar de pico (evita avisar por 9 contra 1). */
  minSpike?: number;
  /** Mínimo de emails sin parser, y su proporción, para sospechar reenvío de más. */
  minNoParser?: number;
  noParserShare?: number;
};

export function assessInboxVolume(
  input: InboxVolumeInput,
  options: InboxVolumeOptions = {},
): InboxVolume {
  const { spikeFactor = 3, minSpike = 30, minNoParser = 20, noParserShare = 0.8 } = options;
  const days = input.previousDays;
  const averagePerDay = days.length ? Math.round(days.reduce((a, b) => a + b, 0) / days.length) : 0;
  const reasons: string[] = [];

  if (input.rejectedLast24h > 0) {
    reasons.push(
      `${input.rejectedLast24h} emails rechazados por el límite de 100 por hora: no se guardaron.`,
    );
  }
  if (input.last24h >= minSpike && input.last24h > spikeFactor * Math.max(averagePerDay, 1)) {
    reasons.push(
      `Llegaron ${input.last24h} en 24 h, contra un promedio de ${averagePerDay} por día.`,
    );
  }
  if (
    input.last24hNoParser >= minNoParser &&
    input.last24hNoParser >= noParserShare * input.last24h
  ) {
    reasons.push(
      `${input.last24hNoParser} de ${input.last24h} sin parser: puede estar llegando correo que no es de empleo (revisá el filtro de reenvío de Gmail).`,
    );
  }
  return { level: reasons.length ? "alto" : "ok", reasons, averagePerDay };
}
