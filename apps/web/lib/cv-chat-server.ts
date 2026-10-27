import { schema as s, type Db } from "@job-search-os/db";
import {
  applyChatMerge,
  buildCvDocument,
  mergeChatHistory,
  type CvChatSeed,
  type CvDocument,
  type CvHistoryInput,
  type CvLinksInput,
  type CvLang,
  type CvSourceData,
  type CvStoredEntry,
} from "@job-search-os/pipeline";
import { and, asc, eq, sql } from "drizzle-orm";
import { withUser } from "./db";
import { listCareerHistory } from "./career-history";
import { loadCvSource, cvChatMode, type CvOptions } from "./cv-source";
import { canCreateInvitations } from "./invitations";

/**
 * Parte de servidor del chat «Armá tu CV con IA» (C-25, CVC-5). Lecturas y escrituras de la persona con
 * `withUser` (RLS); las medidas de gasto leen `llm_calls` con la conexión de servicio, porque el tope
 * diario es global. No se guarda la conversación: acá solo se guarda lo que la persona confirma.
 */

/** ¿Esta persona puede usar el chat? `CV_CHAT_ENABLED`: `all`, `admin` (ADMIN_EMAILS) o apagado. */
export async function cvChatAllowed(userId: string): Promise<boolean> {
  const mode = cvChatMode(process.env);
  if (mode === "all") return true;
  if (mode === "admin") return canCreateInvitations(userId).catch(() => false);
  return false;
}

/** Nombres del catálogo de skills: una tecnología que el modelo nombra y la persona no dijo se descarta. */
export async function skillCatalogNames(db: Db): Promise<string[]> {
  const rows = await db.select({ name: s.skills.name }).from(s.skills).limit(3000);
  return rows.map((r) => r.name);
}

/** Lo ya confirmado, para no repreguntarlo. Los trabajos no se siembran: el chat los pregunta de nuevo. */
export async function loadChatSeed(userId: string): Promise<CvChatSeed> {
  const opts: CvOptions = { lang: "es", includeEmail: true, includeBasics: false };
  const [data, history] = await Promise.all([
    loadCvSource(userId, opts),
    listCareerHistory(userId),
  ]);
  return {
    history: history
      .filter((h) => h.kind !== "trabajo")
      .map(({ kind, organization, title, startMonth, endMonth, bullets }) => ({
        kind,
        organization,
        title,
        startMonth,
        endMonth,
        bullets,
      })),
    skills: (data?.skills ?? []).map((k) => k.name),
    languages: (data?.languages ?? []).map((l) => ({ name: l.name, level: l.level ?? null })),
    links: data?.links ?? {},
  };
}

function toStored(rows: Awaited<ReturnType<typeof listCareerHistory>>): CvStoredEntry[] {
  return rows.map(({ id, kind, organization, title, startMonth, endMonth, bullets }) => ({
    id,
    kind,
    organization,
    title,
    startMonth,
    endMonth,
    bullets,
  }));
}

export type CvChatExtras = {
  skills: readonly string[];
  languages: readonly { name: string; level: string | null }[];
  links: { linkedin?: string | null; github?: string | null; portfolio?: string | null };
  target: string | null;
};

/**
 * La vista previa de lo que quedaría: el CV de la cuenta más lo que salió del chat. Skills, idiomas, links
 * y resumen del chat solo viven en la vista previa; en la base entra únicamente el historial.
 */
export async function buildChatPreview(
  userId: string,
  input: {
    lang: CvLang;
    history: readonly CvHistoryInput[];
    summary: string | null;
    extras: CvChatExtras;
  },
): Promise<CvDocument | null> {
  const opts: CvOptions = { lang: input.lang, includeEmail: true, includeBasics: false };
  const base = await loadCvSource(userId, opts);
  if (!base) return null;
  const existing = toStored(await listCareerHistory(userId));
  const history = applyChatMerge(existing, mergeChatHistory(existing, input.history));
  const data: CvSourceData = {
    ...base,
    headline: base.headline ?? input.extras.target,
    summary: input.summary ?? base.summary,
    links: { ...base.links, ...stripNull(input.extras.links) },
    skills: [...base.skills, ...input.extras.skills.map((name) => ({ name }))],
    languages: [
      ...base.languages,
      ...input.extras.languages.map((l) => ({ name: l.name, level: l.level })),
    ],
    history,
  };
  return buildCvDocument(data, { lang: input.lang, includeEmail: true });
}

function stripNull(l: CvChatExtras["links"]): CvLinksInput {
  const out: CvLinksInput = {};
  if (l.linkedin) out.linkedin = l.linkedin;
  if (l.github) out.github = l.github;
  if (l.portfolio) out.portfolio = l.portfolio;
  return out;
}

export type SaveChatResult = { inserted: number; updated: number; overflow: number };

/**
 * Guarda lo que la persona confirmó. Coincide con una entrada de la cuenta (tipo, empresa, cargo e inicio):
 * la actualiza; si no, suma una con `source = 'chat'`. Tope de 20 entradas, con el mismo lock que la carga
 * manual para que dos confirmaciones a la vez no lo pasen.
 */
export async function saveChatHistory(
  userId: string,
  incoming: readonly CvHistoryInput[],
): Promise<SaveChatResult> {
  return withUser(userId, async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${userId}, 25))`);
    const rows = await tx
      .select()
      .from(s.careerHistory)
      .where(eq(s.careerHistory.userId, userId))
      .orderBy(asc(s.careerHistory.sort), asc(s.careerHistory.createdAt));
    const existing: CvStoredEntry[] = rows.map((r) => ({
      id: r.id,
      kind: r.kind as CvHistoryInput["kind"],
      organization: r.organization,
      title: r.title,
      startMonth: r.startMonth,
      endMonth: r.endMonth,
      bullets: r.bullets,
    }));
    const merge = mergeChatHistory(existing, incoming);
    for (const u of merge.updates) {
      await tx
        .update(s.careerHistory)
        .set({
          endMonth: u.entry.endMonth,
          bullets: [...u.entry.bullets],
          updatedAt: new Date(),
        })
        .where(and(eq(s.careerHistory.id, u.id), eq(s.careerHistory.userId, userId)));
    }
    let sort = rows.reduce((top, r) => Math.max(top, r.sort), -1);
    for (const e of merge.inserts) {
      sort += 1;
      await tx.insert(s.careerHistory).values({
        userId,
        kind: e.kind,
        organization: e.organization,
        title: e.title,
        startMonth: e.startMonth,
        endMonth: e.endMonth,
        bullets: [...e.bullets],
        source: "chat",
        sort,
      });
    }
    return {
      inserted: merge.inserts.length,
      updated: merge.updates.length,
      overflow: merge.overflow,
    };
  });
}
