/**
 * Salud diaria de la beta (C8-11): la pantalla que Mauro mira cada mañana. Puro: la web lee los conteos
 * agregados de la base y acá se decide el semáforo, con los umbrales de `docs/beta/capacidad.md`.
 */
export type HealthLevel = "verde" | "amarillo" | "rojo" | "gris";

/** Envíos por día del plan gratis de Resend (capacidad.md §4). */
export const RESEND_DAILY_CAP = 100;
/** El cron evalúa cada 6 h (capacidad.md §2): más que eso esperando es un ciclo perdido. */
export const QUEUE_AMBER_HOURS = 6;
export const QUEUE_RED_HOURS = 24;
/** 50 por corrida: más de una corrida esperando es amarillo; más de un día (200), rojo. */
export const QUEUE_AMBER_SIZE = 50;
export const QUEUE_RED_SIZE = 200;

export type BetaHealthInput = {
  now: Date;
  queue: { pending: number; oldestPendingAt: Date | null };
  /** `capUsd` null o 0 = sin tope (`LLM_DAILY_CAP_USD=0`). */
  llm: { spent24hUsd: number; capUsd: number | null };
  /** Envíos estimados del día (UTC, como cuenta Resend) y emails recibidos. */
  emails: { sentToday: number; receivedToday: number };
  ingestErrors24h: { inbound: number; pool: number };
  activeToday: number;
  feedback24h: number;
};

export type BetaHealthRow = {
  key: "cola" | "ia" | "emails" | "ingesta" | "activas" | "feedback";
  label: string;
  value: string;
  detail: string;
  level: HealthLevel;
};

export type BetaHealth = { rows: BetaHealthRow[]; overall: HealthLevel };

const RANK: Record<HealthLevel, number> = { gris: 0, verde: 1, amarillo: 2, rojo: 3 };
const money = (n: number) =>
  n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function ago(from: Date, now: Date): string {
  const minutes = Math.max(0, Math.round((now.getTime() - from.getTime()) / 60_000));
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `hace ${hours} h`;
  return `hace ${Math.round(hours / 24)} días`;
}

function queueRow(input: BetaHealthInput): BetaHealthRow {
  const { pending, oldestPendingAt } = input.queue;
  const hours = oldestPendingAt ? (input.now.getTime() - oldestPendingAt.getTime()) / 3_600_000 : 0;
  const level: HealthLevel =
    pending > QUEUE_RED_SIZE || hours > QUEUE_RED_HOURS
      ? "rojo"
      : pending > QUEUE_AMBER_SIZE || hours > QUEUE_AMBER_HOURS
        ? "amarillo"
        : "verde";
  return {
    key: "cola",
    label: "Cola de evaluación",
    value:
      pending === 0
        ? "Vacía"
        : oldestPendingAt
          ? `${pending} en cola · la más vieja, ${ago(oldestPendingAt, input.now)}`
          : `${pending} en proceso`,
    detail:
      "El cron evalúa hasta 50 cada 6 h. Si crece día a día: evaluate cada hora (capacidad.md §2).",
    level,
  };
}

function llmRow(input: BetaHealthInput): BetaHealthRow {
  const { spent24hUsd, capUsd } = input.llm;
  if (!capUsd || capUsd <= 0) {
    return {
      key: "ia",
      label: "Gasto de IA (24 h)",
      value: `USD ${money(spent24hUsd)} · sin tope`,
      detail: "LLM_DAILY_CAP_USD no está cargada o es 0: no hay freno diario.",
      level: "gris",
    };
  }
  const ratio = spent24hUsd / capUsd;
  return {
    key: "ia",
    label: "Gasto de IA (24 h)",
    value: `USD ${money(spent24hUsd)} de ${money(capUsd)}`,
    detail: "Contra LLM_DAILY_CAP_USD. Al llegar, lo que falta se evalúa al día siguiente.",
    level: ratio >= 0.9 ? "rojo" : ratio >= 0.5 ? "amarillo" : "verde",
  };
}

function emailsRow(input: BetaHealthInput): BetaHealthRow {
  const { sentToday, receivedToday } = input.emails;
  return {
    key: "emails",
    label: "Emails enviados hoy",
    value: `${sentToday} de ${RESEND_DAILY_CAP}`,
    detail: `Estimado: recuperación de contraseña, avisos de vencimiento y soporte. Recibidos hoy: ${receivedToday} (confirmar si cuentan en el cupo, capacidad.md §4).`,
    level: sentToday >= 80 ? "rojo" : sentToday >= 50 ? "amarillo" : "verde",
  };
}

function ingestRow(input: BetaHealthInput): BetaHealthRow {
  const { inbound, pool } = input.ingestErrors24h;
  const total = inbound + pool;
  return {
    key: "ingesta",
    label: "Errores de ingesta (24 h)",
    value: total === 0 ? "Ninguno" : `${total} (emails: ${inbound} · pool: ${pool})`,
    detail:
      "Emails que el parser no entendió (van a la cola manual) y descargas del pool que fallaron.",
    level: total >= 10 ? "rojo" : total >= 3 ? "amarillo" : "verde",
  };
}

export function betaHealth(input: BetaHealthInput): BetaHealth {
  const rows: BetaHealthRow[] = [
    queueRow(input),
    llmRow(input),
    emailsRow(input),
    ingestRow(input),
    {
      key: "activas",
      label: "Personas activas hoy",
      value: String(input.activeToday),
      detail:
        "Hicieron algo: un 👍/👎, una postulación o una oferta que no vino del pool (pegada o por email).",
      level: input.activeToday > 0 ? "verde" : "gris",
    },
    {
      key: "feedback",
      label: "«Contanos qué pasó» (24 h)",
      value: input.feedback24h === 0 ? "Nada nuevo" : String(input.feedback24h),
      detail: "Comentarios nuevos de las últimas 24 h, en Métricas → Lo que nos contaron.",
      level: input.feedback24h > 0 ? "amarillo" : "verde",
    },
  ];
  const overall = rows.reduce<HealthLevel>(
    (worst, r) => (RANK[r.level] > RANK[worst] ? r.level : worst),
    "gris",
  );
  return { rows, overall };
}
