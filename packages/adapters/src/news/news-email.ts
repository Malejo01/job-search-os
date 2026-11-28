import { schema as s, type Db } from "@job-search-os/db";
import {
  buildNewsEmail,
  decideNewsEmail,
  NEWS_MAX_OFFERS,
  newsEmailAllowed,
  newsEmailMode,
  newsWindowStart,
  parseContactEmail,
  type NewsOffer,
  type NewsSealWords,
} from "@job-search-os/pipeline";
import { and, asc, eq, gt, isNull, sql } from "drizzle-orm";
import { resetUrlBase } from "../auth/reset-url";
import { MAX_CONSECUTIVE_FAILURES, startOfUtcDay } from "../billing/plan-expiry-notices";
import { sendEmail, type SendEmailParams } from "../email/resend";
import { newsEmailSecret, newsUnsubscribeUrl } from "./unsubscribe-token";

/**
 * Email de novedades (R32-09). Lo dispara un cron semanal contra `/api/cron/news-email` (el paso del workflow lo agrega
 * el responsable). Las reglas de a quién y qué dice son de `pipeline/news-email` (puras); acá está el orden de las
 * cosas, que es lo que lo hace seguro, con el mismo esquema que el aviso de vencimiento del plan:
 *   1. Detrás de `NEWS_EMAIL` (apagada por defecto): apagada no lee la base ni marca a nadie.
 *   2. Sin `RESEND_API_KEY`, `EMAIL_FROM`, URL base o clave de firma de la baja, no hace nada.
 *   3. Tope diario (`NEWS_EMAIL_DAILY_CAP`): cuenta los envíos marcados hoy (UTC).
 *   4. Antes de mandar, «reclama» a la persona con un UPDATE condicional sobre `news_email_sent_at`: dos corridas a la
 *      vez no mandan dos emails. Si el envío falla se devuelve la marca anterior y la próxima corrida reintenta.
 *   5. Sin ofertas nuevas de su carrera no se manda nada (ni se marca).
 * Los logs y la respuesta llevan solo `user_id` y conteos: nunca emails, nombres ni el cuerpo de un error de Resend.
 */

export const NEWS_DAILY_CAP_DEFAULT = 100;

/** Tope diario de la variable: un entero de 1 a 1000; cualquier otra cosa, el de siempre. */
export function newsDailyCap(raw: string | undefined): number {
  const v = raw?.trim() ?? "";
  if (/^\d+$/.test(v)) {
    const n = Number(v);
    if (n >= 1 && n <= 1000) return n;
  }
  return NEWS_DAILY_CAP_DEFAULT;
}

export type NewsCandidate = {
  userId: string;
  email: string;
  displayName: string;
  targetRoles: readonly string[];
  /** `profiles.news_email`. */
  optedIn: boolean;
  newsEmailSentAt: Date | null;
};

/** Lo que el runner necesita de la base. Separado para probar el orden de las cosas sin Postgres. */
export interface NewsStore {
  /** Personas que pueden recibirlo (filtro grueso; el criterio fino es del pipeline). */
  loadCandidates(now: Date): Promise<NewsCandidate[]>;
  /** Cuántos emails se marcaron desde `since`. */
  countSentSince(since: Date): Promise<number>;
  /** Las ofertas nuevas de su carrera desde `since`, de la más afín a la menos, y cuántas hay en total. */
  loadNewOffers(
    userId: string,
    since: Date,
    limit: number,
  ): Promise<{ offers: NewsOffer[]; total: number }>;
  /** Reclama a la persona para esta corrida. false = otra corrida se adelantó o se dio de baja. */
  claim(candidate: NewsCandidate, now: Date): Promise<boolean>;
  /** Devuelve la marca anterior (el envío falló). Solo si la marca sigue siendo la de este reclamo. */
  release(candidate: NewsCandidate, claimedAt: Date): Promise<void>;
}

export type NewsLogger = {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
};

export type NewsSkipReason = "apagado" | "baja" | "reciente" | "sin_novedades";

export type NewsRun = {
  ok: true;
  /** Por qué no se hizo nada, si fue así. */
  skipped?: "apagado" | "sin_resend" | "sin_url" | "sin_clave" | "tope_diario";
  /** Personas a las que les tocaba (con ofertas nuevas y permiso). */
  due: number;
  sent: number;
  failed: number;
  /** Elegidas que otra corrida ya había reclamado. */
  raced: number;
  /** Cuántos emails más caben hoy. */
  capLeft: number;
  /** Cuántas personas se descartaron y por qué. */
  skippedBy: Partial<Record<NewsSkipReason, number>>;
};

/** Textos que pone la web (R30): las palabras de los sellos y la aclaración fija, y cómo nombrar una carrera. */
export type NewsLabels = {
  /** Rótulo de una carrera del catálogo, o null si no se conoce (no se nombra). */
  careerLabel(role: string): string | null;
  sealWords: NewsSealWords;
  aclaracion: string;
};

/** Del error de Resend queda solo el código HTTP: el cuerpo puede traer el email de destino. */
function safeSendError(error: unknown): { status: number | null } {
  const match = /HTTP (\d{3})/.exec(error instanceof Error ? error.message : "");
  return { status: match ? Number(match[1]) : null };
}

export async function runNewsEmail(deps: {
  store: NewsStore;
  env: Record<string, string | undefined>;
  now: Date;
  logger: NewsLogger;
  labels: NewsLabels;
  send?: (params: SendEmailParams, apiKey: string) => Promise<void>;
}): Promise<NewsRun> {
  const { store, env, now, logger, labels } = deps;
  const send = deps.send ?? ((params, apiKey) => sendEmail(params, apiKey));
  const empty = { due: 0, sent: 0, failed: 0, raced: 0, capLeft: 0, skippedBy: {} };

  // 1. Apagado: ni lee la base ni marca a nadie
  if (newsEmailMode(env) === "off") return { ok: true, skipped: "apagado", ...empty };

  // 2. La configuración de Resend, la URL base y la clave de firma de la baja
  const apiKey = env.RESEND_API_KEY?.trim();
  const from = env.EMAIL_FROM?.trim();
  if (!apiKey || !from) {
    logger.warn({}, "news-email: faltan RESEND_API_KEY o EMAIL_FROM; no se manda nada");
    return { ok: true, skipped: "sin_resend", ...empty };
  }
  const base = resetUrlBase(env);
  if (!base.ok) {
    logger.warn({ reason: base.error }, "news-email: sin URL base; no se manda nada");
    return { ok: true, skipped: "sin_url", ...empty };
  }
  const secret = newsEmailSecret(env);
  if (!secret) {
    logger.warn({}, "news-email: sin clave para firmar la baja; no se manda nada");
    return { ok: true, skipped: "sin_clave", ...empty };
  }

  // 3. Tope diario
  const cap = newsDailyCap(env.NEWS_EMAIL_DAILY_CAP);
  const sentToday = await store.countSentSince(startOfUtcDay(now));
  const capLeft = Math.max(0, cap - sentToday);
  if (capLeft === 0) {
    logger.warn({ cap }, "news-email: tope diario alcanzado; no se manda nada");
    return { ok: true, skipped: "tope_diario", ...empty };
  }

  const contact = parseContactEmail(env.CONTACT_EMAIL);
  const settingsUrl = `${base.url}/settings#novedades`;
  const candidates = await store.loadCandidates(now);

  const skippedBy: NewsRun["skippedBy"] = {};
  const skip = (reason: NewsSkipReason) => {
    skippedBy[reason] = (skippedBy[reason] ?? 0) + 1;
  };
  let due = 0;
  let sent = 0;
  let failed = 0;
  let raced = 0;
  let consecutiveFailures = 0;

  for (const candidate of candidates) {
    if (sent + failed + raced >= capLeft) break;
    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      logger.error({ failed }, "news-email: demasiados fallos seguidos; se corta la corrida");
      break;
    }
    const log = { user_id: candidate.userId };
    const allowed = newsEmailAllowed(env, candidate.email);
    // Primero lo que no necesita mirar ofertas (variable, baja, envío reciente): ahorra una consulta por persona
    const pre = decideNewsEmail({
      allowed,
      optedIn: candidate.optedIn,
      lastSentAt: candidate.newsEmailSentAt,
      now,
      newOffers: 1,
    });
    if (!pre.send) {
      skip(pre.reason);
      continue;
    }
    const since = newsWindowStart(candidate.newsEmailSentAt, now);
    const { offers, total } = await store.loadNewOffers(candidate.userId, since, NEWS_MAX_OFFERS);
    const decision = decideNewsEmail({
      allowed,
      optedIn: candidate.optedIn,
      lastSentAt: candidate.newsEmailSentAt,
      now,
      newOffers: total,
    });
    if (!decision.send) {
      skip(decision.reason);
      continue;
    }
    due++;
    // 4. Reclamo antes del envío: dos corridas a la vez no mandan dos emails
    if (!(await store.claim(candidate, now))) {
      raced++;
      logger.info(log, "news-email: otra corrida ya la reclamó");
      continue;
    }
    try {
      const unsubscribeUrl = newsUnsubscribeUrl(base.url, candidate.userId, secret, now);
      const careerLabels = candidate.targetRoles.flatMap((role) => labels.careerLabel(role) ?? []);
      const email = buildNewsEmail({
        displayName: candidate.displayName,
        careerLabels,
        offers,
        total,
        appUrl: base.url,
        unsubscribeUrl,
        settingsUrl,
        contactEmail: contact,
        sealWords: labels.sealWords,
        aclaracion: labels.aclaracion,
      });
      await send(
        {
          to: candidate.email,
          from,
          subject: email.subject,
          text: email.text,
          html: email.html,
          // Baja en un clic desde el propio cliente de correo (RFC 8058)
          headers: {
            "List-Unsubscribe": `<${unsubscribeUrl}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          },
          // Un reintento HTTP del mismo envío no sale dos veces
          idempotencyKey: `news-email:${candidate.userId}:${now.toISOString().slice(0, 10)}`,
        },
        apiKey,
      );
      sent++;
      consecutiveFailures = 0;
      logger.info(log, "news-email: enviado");
    } catch (error) {
      failed++;
      consecutiveFailures++;
      logger.error({ ...log, ...safeSendError(error) }, "news-email: no se pudo mandar");
      try {
        await store.release(candidate, now);
      } catch {
        // Queda marcada sin haberse enviado: mejor perder un email que mandar dos
        logger.error(log, "news-email: no se pudo devolver la marca");
      }
    }
  }
  return { ok: true, due, sent, failed, raced, capLeft: Math.max(0, capLeft - sent), skippedBy };
}

/** Margen del filtro grueso de la consulta de candidatas. */
const LOAD_LIMIT = 500;
/** Estados de una oferta que todavía vale mencionar (no descartadas, cerradas ni rechazadas). */
const NEWS_JOB_STATUSES = ["nueva", "prefiltrada", "evaluada"] as const;

/**
 * El store real. Corre con el rol dueño (purpose `service`): ve todos los perfiles y los emails. Las ofertas son las
 * de la persona que vinieron del pool (`public_job_id`), o sea de su carrera: lo que cargó a mano no entra.
 */
export function createDbNewsStore(db: Db): NewsStore {
  return {
    async loadCandidates() {
      const rows = await db
        .select({
          userId: s.profiles.userId,
          email: s.users.email,
          displayName: s.profiles.displayName,
          targetRoles: s.profiles.targetRoles,
          optedIn: s.profiles.newsEmail,
          newsEmailSentAt: s.profiles.newsEmailSentAt,
        })
        .from(s.profiles)
        .innerJoin(s.users, eq(s.users.id, s.profiles.userId))
        .where(
          and(
            // Las cuentas de prueba y las bloqueadas no reciben nada; la baja ya filtra acá y de nuevo en el pipeline
            eq(s.users.isTest, false),
            isNull(s.users.blockedAt),
            eq(s.profiles.newsEmail, true),
            sql`cardinality(${s.profiles.targetRoles}) > 0`,
          ),
        )
        // Las que nunca recibieron primero, después las que hace más que no reciben
        .orderBy(sql`${s.profiles.newsEmailSentAt} asc nulls first`, asc(s.profiles.userId))
        .limit(LOAD_LIMIT);
      return rows;
    },

    async countSentSince(since) {
      const [row] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(s.profiles)
        .where(gt(s.profiles.newsEmailSentAt, since));
      return row?.n ?? 0;
    },

    async loadNewOffers(userId, since, limit) {
      const rows = (await db.execute(sql`
        select j.id, j.title, j.company_raw as company,
               (select e.score from evaluations e where e.job_id = j.id order by e.created_at desc limit 1) as score,
               count(*) over ()::int as total
          from jobs j
         where j.user_id = ${userId}
           and j.public_job_id is not null
           and j.first_seen_at > ${since.toISOString()}::timestamptz
           and j.status in (${sql.join(
             NEWS_JOB_STATUSES.map((st) => sql`${st}`),
             sql`, `,
           )})
         order by score desc nulls last, j.first_seen_at desc, j.id
         limit ${limit}
      `)) as unknown as {
        id: string;
        title: string;
        company: string | null;
        score: number | string | null;
        total: number;
      }[];
      return {
        offers: rows.map((r) => ({
          id: r.id,
          title: r.title,
          company: r.company,
          score: r.score === null ? null : Number(r.score),
        })),
        total: rows[0]?.total ?? 0,
      };
    },

    async claim(candidate, now) {
      const seen = candidate.newsEmailSentAt;
      const claimed = await db
        .update(s.profiles)
        .set({ newsEmailSentAt: now })
        .where(
          and(
            eq(s.profiles.userId, candidate.userId),
            // Si se dio de baja entre la lectura y el envío, no se manda
            eq(s.profiles.newsEmail, true),
            seen
              ? sql`date_trunc('milliseconds', ${s.profiles.newsEmailSentAt}) = ${seen.toISOString()}::timestamptz`
              : isNull(s.profiles.newsEmailSentAt),
          ),
        )
        .returning({ userId: s.profiles.userId });
      return claimed.length === 1;
    },

    async release(candidate, claimedAt) {
      await db
        .update(s.profiles)
        .set({ newsEmailSentAt: candidate.newsEmailSentAt })
        .where(
          and(
            eq(s.profiles.userId, candidate.userId),
            sql`date_trunc('milliseconds', ${s.profiles.newsEmailSentAt}) = ${claimedAt.toISOString()}::timestamptz`,
          ),
        );
    },
  };
}
