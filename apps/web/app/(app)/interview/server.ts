import { createDb, requireDatabaseUrl, schema as s, type Db } from "@job-search-os/db";
import {
  countInterviewStarts,
  createLogger,
  deleteInterviewSession,
  listInterviewScores,
  listInterviewSessions,
  loadInterviewSession,
  type InterviewDeps,
} from "@job-search-os/adapters";
import {
  buildInterviewProgress,
  interviewMaxSimulationsPerDay,
  type InterviewProgress,
} from "@job-search-os/pipeline";
import { and, desc, notInArray, eq } from "drizzle-orm";
import { withUser } from "@/lib/db";
import { serviceLlm } from "@/lib/llm-service";
import { ROLE_SKILLS } from "@/lib/skill-levels";

/**
 * Parte de servidor del simulador de entrevistas. Los datos de la persona se leen y escriben con `withUser`
 * (RLS); la conexión de servicio solo sirve para reservar gasto, registrar las llamadas al modelo y leer las
 * rutas de `model_routing`, y se cierra apenas termina el pedido.
 */

/** Ofertas que se pueden usar para practicar: las vigentes de la persona, las más recientes primero. */
const DISCARDED = ["descartada", "descartada_prefiltro", "rechazo_automatico", "cerrada"] as const;
const OFFERS_LIMIT = 20;
const ROLE_LABELS = ROLE_SKILLS as Record<string, { label: string } | undefined>;

export type InterviewStartData = {
  sessions: { id: string; title: string; status: string; createdAt: Date; answered: number }[];
  /** Evolución de los puntajes de las simulaciones terminadas (R23-02). */
  progress: InterviewProgress;
  offers: { id: string; title: string; company: string }[];
  /** Carrera sugerida desde los puestos que eligió la persona; vacía si no eligió ninguno. */
  suggestedCareer: string;
  /** Simulaciones que todavía puede empezar en las próximas 24 horas. */
  left: number;
  /** Tope de simulaciones por día (`INTERVIEW_MAX_SIMULATIONS_PER_DAY`). */
  max: number;
};

export async function loadStartData(userId: string, now = new Date()): Promise<InterviewStartData> {
  return withUser(userId, async (tx) => {
    const db = tx as unknown as Db;
    const sessions = await listInterviewSessions(db, userId, 6);
    const progress = buildInterviewProgress(await listInterviewScores(db, userId));
    const offers = await db
      .select({ id: s.jobs.id, title: s.jobs.title, company: s.jobs.companyRaw })
      .from(s.jobs)
      .where(and(eq(s.jobs.userId, userId), notInArray(s.jobs.status, [...DISCARDED])))
      .orderBy(desc(s.jobs.firstSeenAt))
      .limit(OFFERS_LIMIT);
    const [profile] = await db
      .select({ targetRoles: s.profiles.targetRoles })
      .from(s.profiles)
      .where(eq(s.profiles.userId, userId))
      .limit(1);
    const firstRole = profile?.targetRoles?.[0];
    const max = interviewMaxSimulationsPerDay(process.env);
    // Cuenta también las simulaciones borradas (llamadas de `llm_calls`): borrar no libera cupo
    const inDay = await countInterviewStarts(db, userId, now);
    return {
      sessions,
      progress,
      offers,
      suggestedCareer: firstRole ? (ROLE_LABELS[firstRole]?.label ?? "") : "",
      left: Math.max(0, max - inDay),
      max,
    };
  });
}

export async function loadSession(userId: string, sessionId: string) {
  return withUser(userId, (tx) => loadInterviewSession(tx as unknown as Db, userId, sessionId));
}

/** Borra una simulación de la persona (RLS). `false` si no existe o no es suya. */
export async function removeSession(userId: string, sessionId: string): Promise<boolean> {
  return withUser(userId, (tx) => deleteInterviewSession(tx as unknown as Db, userId, sessionId));
}

/**
 * Corre `fn` con las dependencias del simulador. Con `LLM_DEMO=1` el cliente es el simulado (sin red ni
 * gasto): lo decide `serviceLlm`.
 */
export async function withInterviewDeps<T>(
  userId: string,
  fn: (deps: InterviewDeps) => Promise<T>,
): Promise<T> {
  const conn = createDb(requireDatabaseUrl({ purpose: "service" }), { max: 2 });
  try {
    const logger = createLogger({ user_id: userId });
    return await fn({
      llm: serviceLlm(conn.db, logger),
      reserveDb: conn.db,
      withUser: (id, run) => withUser(id, (tx) => run(tx as unknown as Db)),
      logger,
    });
  } finally {
    await conn.close();
  }
}
