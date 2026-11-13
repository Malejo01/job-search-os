/**
 * Salud diaria de la beta (C8-11): la pantalla que Mauro mira cada mañana. Puro: la web lee los conteos
 * agregados de la base y acá se decide el semáforo, con los umbrales de `docs/beta/capacidad.md`.
 */
import { baseDomain } from "./filter-leak";

export type HealthLevel = "verde" | "amarillo" | "rojo" | "gris";

/** Envíos por día del plan gratis de Resend (capacidad.md §4). */
export const RESEND_DAILY_CAP = 100;
/** El cron evalúa cada 6 h (capacidad.md §2): más que eso esperando es un ciclo perdido. */
export const QUEUE_AMBER_HOURS = 6;
export const QUEUE_RED_HOURS = 24;
/** 50 por corrida: más de una corrida esperando es amarillo; más de un día (200), rojo. */
export const QUEUE_AMBER_SIZE = 50;
export const QUEUE_RED_SIZE = 200;

/** Evaluaciones fallidas en 24 h (R8-7): mismos cortes que `/api/cron/status` (más de 10, o más de la mitad). */
export const EVAL_FAILED_AMBER = 3;
export const EVAL_FAILED_RED = 10;
export const EVAL_FAILED_RATIO_RED = 0.5;
export const EVAL_FAILED_RATIO_MIN_ATTEMPTS = 4;
/** El pool se descarga cada 6 h (capacidad.md §2): 13 h son dos corridas perdidas (como `/api/cron/status`). */
export const POOL_AMBER_HOURS = 7;
export const POOL_RED_HOURS = 13;
/** Emails de 7 días que ningún parser leyó: 5 empiezan a notarse, 30 es un portal entero sin leer. */
export const NO_PARSER_AMBER = 5;
export const NO_PARSER_RED = 30;

/**
 * Portales de empleo que se nombran en la pantalla (primera etiqueta del dominio base). Cualquier otro
 * remitente cuenta como «otros»: un dominio de una empresa o de una persona nunca se muestra.
 */
const KNOWN_PORTALS = new Set([
  "computrabajo",
  "bumeran",
  "zonajobs",
  "jooble",
  "infojobs",
  "workana",
  "glassdoor",
  "indeed",
  "linkedin",
  "getonbrd",
  "getonboard",
]);

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
  /** Cola `evaluate_job`: mensajes fallidos y terminados (hechos + fallidos) en 24 h. */
  evalQueue24h: { failed: number; finished: number };
  /** Última descarga del pool que no terminó en error (ventana de 7 días); null = ninguna. */
  pool: { lastOkAt: Date | null };
  /** Emails de 7 días sin parser (cola manual), con su total y el host del remitente. Solo conteos. */
  inboundNoParser7d: { total: number; byHost: { host: string; count: number }[] };
  /** Invitaciones sin usar ni vencer, y las que vencen en las próximas 48 h. */
  invitations: { pending: number; expiringIn48h: number };
};

export type BetaHealthRow = {
  key:
    | "cola"
    | "ia"
    | "emails"
    | "ingesta"
    | "activas"
    | "feedback"
    | "evaluaciones"
    | "pool"
    | "portales"
    | "invitaciones";
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

function evaluationsRow(input: BetaHealthInput): BetaHealthRow {
  const { failed, finished } = input.evalQueue24h;
  const ratioHigh =
    finished >= EVAL_FAILED_RATIO_MIN_ATTEMPTS && failed / finished > EVAL_FAILED_RATIO_RED;
  return {
    key: "evaluaciones",
    label: "Evaluaciones fallidas (24 h)",
    value: failed === 0 ? "Ninguna" : `${failed} fallidas de ${finished} terminadas`,
    detail:
      "Ofertas que agotaron sus reintentos sin puntaje: la persona las ve «en cola» para siempre. Ver /api/cron/status.",
    level:
      failed > EVAL_FAILED_RED || ratioHigh
        ? "rojo"
        : failed >= EVAL_FAILED_AMBER
          ? "amarillo"
          : "verde",
  };
}

function poolRow(input: BetaHealthInput): BetaHealthRow {
  const { lastOkAt } = input.pool;
  if (!lastOkAt) {
    return {
      key: "pool",
      label: "Última descarga del pool",
      value: "Ninguna en 7 días",
      detail: "Sin descargas buenas en la ventana: revisar que el cron `cron` de GitHub corra.",
      level: "gris",
    };
  }
  const hours = (input.now.getTime() - lastOkAt.getTime()) / 3_600_000;
  return {
    key: "pool",
    label: "Última descarga del pool",
    value: ago(lastOkAt, input.now),
    detail: "Última descarga de alguna fuente que no terminó en error. El cron corre cada 6 h.",
    level: hours > POOL_RED_HOURS ? "rojo" : hours > POOL_AMBER_HOURS ? "amarillo" : "verde",
  };
}

function portalsRow(input: BetaHealthInput): BetaHealthRow {
  const { total, byHost } = input.inboundNoParser7d;
  const byPortal = new Map<string, number>();
  for (const { host, count } of byHost) {
    const base = baseDomain(host);
    if (!KNOWN_PORTALS.has(base.split(".")[0] ?? "")) continue;
    byPortal.set(base, (byPortal.get(base) ?? 0) + count);
  }
  const named = [...byPortal].sort((a, b) => b[1] - a[1]);
  const others = Math.max(0, total - named.reduce((sum, [, n]) => sum + n, 0));
  const parts = [
    String(total),
    ...named.slice(0, 3).map(([d, n]) => `${d} ${n}`),
    ...(others > 0 && named.length > 0 ? [`otros ${others}`] : []),
  ];
  return {
    key: "portales",
    label: "Emails sin parser (7 días)",
    value: total === 0 ? "Ninguno" : parts.join(" · "),
    detail:
      "Emails que fueron a la cola manual por no haber lector para ese remitente (por ejemplo, un portal nuevo). Solo se nombran portales conocidos.",
    level: total >= NO_PARSER_RED ? "rojo" : total >= NO_PARSER_AMBER ? "amarillo" : "verde",
  };
}

function invitationsRow(input: BetaHealthInput): BetaHealthRow {
  const { pending, expiringIn48h } = input.invitations;
  return {
    key: "invitaciones",
    label: "Invitaciones sin usar",
    value:
      pending === 0
        ? "Ninguna"
        : expiringIn48h > 0
          ? `${pending} sin usar · ${expiringIn48h} vencen en 48 h`
          : `${pending} sin usar`,
    detail:
      "Creadas, sin canjear y sin vencer (vencen a los 14 días). Si una persona esperada no entró, reenviar el link desde /settings/invitations.",
    level: pending === 0 ? "gris" : expiringIn48h > 0 ? "amarillo" : "verde",
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
    evaluationsRow(input),
    poolRow(input),
    portalsRow(input),
    invitationsRow(input),
  ];
  const overall = rows.reduce<HealthLevel>(
    (worst, r) => (RANK[r.level] > RANK[worst] ? r.level : worst),
    "gris",
  );
  return { rows, overall };
}
