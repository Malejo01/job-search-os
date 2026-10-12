import { schema as s, type Db } from "@job-search-os/db";
import {
  canonicalUrl,
  inferRoleHints,
  normalizeCompany,
  normalizeTitle,
  poolDedup,
  stripContacts,
  textShingles,
  type PoolRecent,
  type RawJob,
  type Term,
} from "@job-search-os/pipeline";
import { and, eq, gte, isNotNull, isNull, or, sql } from "drizzle-orm";
import { jdHash, upsertCompany } from "../ingest/ingest-job";
import type { Logger } from "../logger";
import { safeDbError } from "../logging/safe-error";
import { loadTaxonomy, syncPublicJobSkillsFromText } from "../skills/sync";
import { pgBlobStorage, type BlobStorage } from "../storage/blob";

/**
 * Upsert del pool global de ofertas (ADR-014). Corre con la conexión de servicio (dueña): la app
 * solo lee `public_jobs`. Por cada RawJob: normaliza (contactos fuera de título, empresa,
 * ubicación, JD y crudo antes de calcular o guardar nada), decide con `poolDedup` y escribe. No
 * asigna nada a usuarios: no toca `jobs` ni `job_sources`.
 * Falla cerrado: sin id, o sin URL http/https de la fuente, se salta el aviso; no se inventa nada.
 * Un error en un aviso no corta el lote.
 */
export type PoolUpsertSummary = {
  received: number;
  inserted: number;
  updated: number;
  unchanged: number;
  copies: number;
  skipped: number;
  errors: number;
  /** El lote se cortó porque `shouldStop` devolvió true; lo que quedó sin procesar no cuenta. */
  stopped: boolean;
};

export type PoolUpsertDeps = {
  db: Db;
  logger: Logger;
  now?: () => Date;
  /** Taxonomía compilada; si no viene, se carga una vez de la base. */
  taxonomy?: readonly Term[];
  /** Dónde va el crudo. Por defecto raw_blobs en la misma conexión, con `user_id` null. */
  storage?: BlobStorage;
  /** Se consulta antes de cada aviso; si devuelve true se corta el lote (límite de tiempo). */
  shouldStop?: () => boolean;
};

const DAY_MS = 24 * 60 * 60 * 1000;
/** Ventana de dedup del pool; la misma que usa `poolDedup` por defecto. */
const WINDOW_DAYS = 14;

/** Solo http/https: otra cosa (javascript:, data:) no es una URL de aviso y nunca se guarda. */
function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

type Normalized = {
  sourceUrl: string;
  externalId: string;
  canonical: string | null;
  jdText: string | null;
  hash: string | null;
  shingles: string[] | null;
  titleNormalized: string;
  companyNormalized: string;
  roleHints: string[];
};

function normalize(raw: RawJob, externalId: string, sourceUrl: string): Normalized {
  const url = canonicalUrl(sourceUrl);
  const jdText = raw.jdText ? stripContacts(raw.jdText) : null;
  return {
    sourceUrl,
    externalId,
    canonical: url.ok ? url.value : null,
    jdText,
    hash: jdText ? jdHash(jdText) : null,
    shingles: jdText ? textShingles(jdText) : null,
    titleNormalized: normalizeTitle(raw.title),
    companyNormalized: normalizeCompany(raw.companyRaw),
    roleHints: inferRoleHints({
      sourceKind: raw.source.kind,
      title: raw.title,
      tags: raw.tags,
      categories: raw.categories,
    }),
  };
}

/** Filas del pool que pueden decidir el dedup de este aviso. */
async function loadCandidates(
  db: Db,
  raw: RawJob,
  n: Normalized,
  now: Date,
): Promise<PoolRecent[]> {
  const since = new Date(now.getTime() - WINDOW_DAYS * DAY_MS);
  const t = s.publicJobs;
  const rows = await db
    .select({
      id: t.id,
      sourceKind: t.sourceKind,
      externalId: t.externalId,
      canonicalUrl: t.canonicalUrl,
      jdHash: t.jdHash,
      jdShingles: t.jdShingles,
      companyNormalized: t.companyNormalized,
      firstSeenAt: t.firstSeenAt,
      dedupOfId: t.dedupOfId,
    })
    .from(t)
    .where(
      or(
        and(eq(t.sourceKind, raw.source.kind), eq(t.externalId, n.externalId)),
        n.canonical ? eq(t.canonicalUrl, n.canonical) : undefined,
        n.hash ? eq(t.jdHash, n.hash) : undefined,
        n.companyNormalized
          ? and(
              eq(t.companyNormalized, n.companyNormalized),
              gte(t.firstSeenAt, since),
              isNotNull(t.jdShingles),
            )
          : undefined,
      ),
    );
  return rows.map((r) => ({
    id: r.id,
    sourceKind: r.sourceKind,
    externalId: r.externalId,
    canonicalUrl: r.canonicalUrl,
    jdHash: r.jdHash,
    jdShingles: r.jdShingles,
    companyNormalized: r.companyNormalized,
    seenAt: r.firstSeenAt,
    firstSeenAt: r.firstSeenAt,
    dedupOfId: r.dedupOfId,
  }));
}

/**
 * Aplica `stripContacts` a los valores string de un JSON ya parseado (nunca al texto serializado:
 * rompería ids numéricos). Las URLs http/https se dejan: un id largo en el path no es un teléfono.
 */
function scrubValues(value: unknown): unknown {
  if (typeof value === "string") return isHttpUrl(value) ? value : stripContacts(value);
  if (Array.isArray(value)) return value.map(scrubValues);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrubValues(v)]));
  }
  return value;
}

/**
 * Crudo de la fuente (o el RawJob), sin contactos, valor por valor. Si el cuerpo original no es
 * JSON válido, se limpia como texto. Sin usuario: `kind` = `pool_<source_kind>`.
 */
function rawPayload(raw: RawJob): { contentType: string; body: string } {
  const { original, ...source } = raw.source;
  if (original) {
    try {
      return {
        contentType: original.contentType,
        body: JSON.stringify(scrubValues(JSON.parse(original.body))),
      };
    } catch {
      return { contentType: original.contentType, body: stripContacts(original.body) };
    }
  }
  const plain: unknown = JSON.parse(JSON.stringify({ ...raw, source }));
  return { contentType: "application/json", body: JSON.stringify(scrubValues(plain)) };
}

/** Columnas de contenido del aviso (sin el JD): lo que, si cambia, obliga a actualizar la fila. */
type ContentFields = {
  title: string;
  companyRaw: string;
  locationRaw: string | null;
  countriesAllowed: string[] | null;
  modality: string | null;
  contractType: string | null;
  seniority: string | null;
  salaryMinUsd: number | null;
  salaryMaxUsd: number | null;
  salaryPeriod: string | null;
  salaryNote: string | null;
  postedAt: Date | null;
  categories: string[] | null;
  tags: string[] | null;
  jdHash: string | null;
};

function contentSignature(f: ContentFields): string {
  return JSON.stringify([
    f.title,
    f.companyRaw,
    f.locationRaw,
    f.countriesAllowed,
    f.modality,
    f.contractType,
    f.seniority,
    f.salaryMinUsd,
    f.salaryMaxUsd,
    f.salaryPeriod,
    f.salaryNote,
    f.postedAt?.toISOString() ?? null,
    f.categories,
    f.tags,
    f.jdHash,
  ]);
}

/** Columnas que dependen del contenido del aviso (se reescriben cuando la firma cambia). */
function contentColumns(raw: RawJob, n: Normalized, companyId: string | null) {
  return {
    sourceName: raw.source.name,
    sourceUrl: n.sourceUrl,
    canonicalUrl: n.canonical,
    title: raw.title,
    titleNormalized: n.titleNormalized,
    companyRaw: raw.companyRaw,
    companyNormalized: n.companyNormalized,
    companyId,
    locationRaw: raw.locationRaw,
    countriesAllowed: raw.countriesAllowed,
    modality: raw.modality,
    contractType: raw.contractType,
    seniority: raw.seniority,
    lang: raw.lang,
    salaryMinUsd: raw.salaryMinUsd,
    salaryMaxUsd: raw.salaryMaxUsd,
    salaryPeriod: raw.salaryPeriod,
    salaryNote: raw.salaryNote,
    weeklyHours: raw.weeklyHours,
    candidatesCount: raw.candidatesCount,
    jdText: n.jdText,
    jdHash: n.hash,
    jdShingles: n.shingles,
    tags: raw.tags,
    categories: raw.categories ?? null,
    roleHints: n.roleHints,
    postedAt: raw.postedAt,
  };
}

/** Borra un crudo del pool (solo los sin usuario). */
async function dropBlob(db: Db, ref: string): Promise<void> {
  if (!ref.startsWith("pg:")) return;
  await db
    .delete(s.rawBlobs)
    .where(and(eq(s.rawBlobs.id, ref.slice(3)), isNull(s.rawBlobs.userId)));
}

export async function upsertPoolJobs(
  raws: readonly RawJob[],
  deps: PoolUpsertDeps,
): Promise<PoolUpsertSummary> {
  const { db, logger } = deps;
  const now = deps.now?.() ?? new Date();
  const storage = deps.storage ?? pgBlobStorage(db);
  const summary: PoolUpsertSummary = {
    received: raws.length,
    inserted: 0,
    updated: 0,
    unchanged: 0,
    copies: 0,
    skipped: 0,
    errors: 0,
    stopped: false,
  };
  let taxonomy = deps.taxonomy;

  for (const original of raws) {
    if (deps.shouldStop?.()) {
      summary.stopped = true;
      break;
    }
    const log = logger.child({
      source: original.source.kind,
      external_id: original.source.externalId,
    });
    const externalId = original.source.externalId?.trim();
    const sourceUrl = original.source.url?.trim();
    if (!externalId || !sourceUrl || !isHttpUrl(sourceUrl)) {
      summary.skipped++;
      continue;
    }
    // Contactos fuera de lo que se guarda: título, empresa y ubicación además del JD y el crudo
    const raw: RawJob = {
      ...original,
      title: stripContacts(original.title),
      companyRaw: stripContacts(original.companyRaw),
      locationRaw: original.locationRaw ? stripContacts(original.locationRaw) : null,
    };
    // Crudo guardado que todavía no cuelga de ninguna fila: si algo falla, se borra para no dejarlo huérfano
    let pendingBlob: string | null = null;
    try {
      const n = normalize(raw, externalId, sourceUrl);
      if (n.jdText && !taxonomy) taxonomy = await loadTaxonomy(db);
      const recent = await loadCandidates(db, raw, n, now);
      const decision = poolDedup(
        {
          sourceKind: raw.source.kind,
          externalId,
          canonicalUrl: n.canonical,
          jdHash: n.hash,
          jdShingles: n.shingles,
          companyNormalized: n.companyNormalized,
          seenAt: now,
        },
        recent,
      );

      if (decision.kind === "same") {
        const t = s.publicJobs;
        const [stored] = await db
          .select({
            title: t.title,
            companyRaw: t.companyRaw,
            locationRaw: t.locationRaw,
            countriesAllowed: t.countriesAllowed,
            modality: t.modality,
            contractType: t.contractType,
            seniority: t.seniority,
            salaryMinUsd: t.salaryMinUsd,
            salaryMaxUsd: t.salaryMaxUsd,
            salaryPeriod: t.salaryPeriod,
            salaryNote: t.salaryNote,
            postedAt: t.postedAt,
            categories: t.categories,
            tags: t.tags,
            jdHash: t.jdHash,
            rawRef: t.rawRef,
          })
          .from(t)
          .where(eq(t.id, decision.id));
        const incoming = contentSignature({
          ...raw,
          categories: raw.categories ?? null,
          jdHash: n.hash,
        });
        if (stored && contentSignature(stored) === incoming) {
          await db.update(t).set({ lastSeenAt: now }).where(eq(t.id, decision.id));
          // Una fila sin skills pero con JD (la sincronización falló antes) se rehace
          if (n.jdText && taxonomy) {
            const [{ n: have } = { n: 0 }] = await db
              .select({ n: sql<number>`count(*)::int` })
              .from(s.publicJobSkills)
              .where(eq(s.publicJobSkills.publicJobId, decision.id));
            if (!have) await syncPublicJobSkillsFromText(db, decision.id, n.jdText, taxonomy);
          }
          summary.unchanged++;
          continue;
        }
        // El aviso cambió (JD, sueldo, título...): se reescribe el contenido y el crudo nuevo
        // reemplaza al anterior
        const rawRef = await storage.put({
          userId: null,
          kind: `pool_${raw.source.kind}`,
          ...rawPayload(raw),
        });
        pendingBlob = rawRef;
        const companyId = await upsertCompany(db, raw.companyRaw);
        await db.transaction(async (tx) => {
          const txDb = tx as unknown as Db;
          await txDb
            .update(t)
            .set({ ...contentColumns(raw, n, companyId), rawRef, lastSeenAt: now, updatedAt: now })
            .where(eq(t.id, decision.id));
          if (n.jdText && taxonomy) {
            await syncPublicJobSkillsFromText(txDb, decision.id, n.jdText, taxonomy);
          }
        });
        pendingBlob = null;
        if (stored?.rawRef) await dropBlob(db, stored.rawRef);
        summary.updated++;
        log.info({ public_job_id: decision.id }, "pool: actualizado");
        continue;
      }

      // new o copy_of: fila nueva (la copia no se fusiona: conserva su propio texto)
      const dedupOfId = decision.kind === "copy_of" ? decision.id : null;
      const rawRef = await storage.put({
        userId: null,
        kind: `pool_${raw.source.kind}`,
        ...rawPayload(raw),
      });
      pendingBlob = rawRef;
      const companyId = await upsertCompany(db, raw.companyRaw);
      // Fila y skills en una transacción: no queda un aviso nuevo sin sus skills
      const row = await db.transaction(async (tx) => {
        const txDb = tx as unknown as Db;
        const [inserted] = await txDb
          .insert(s.publicJobs)
          .values({
            sourceKind: raw.source.kind,
            externalId,
            ...contentColumns(raw, n, companyId),
            firstSeenAt: now,
            lastSeenAt: now,
            dedupOfId,
            rawRef,
          })
          .onConflictDoUpdate({
            target: [s.publicJobs.sourceKind, s.publicJobs.externalId],
            set: { lastSeenAt: now },
          })
          .returning({ id: s.publicJobs.id, created: sql<boolean>`(xmax = 0)` });
        if (inserted!.created && n.jdText && taxonomy) {
          await syncPublicJobSkillsFromText(txDb, inserted!.id, n.jdText, taxonomy);
        }
        return inserted!;
      });
      if (!row.created) {
        // Otra corrida lo insertó entre la consulta y el insert: el crudo recién guardado sobra
        await dropBlob(db, rawRef);
        pendingBlob = null;
        summary.unchanged++;
        continue;
      }
      pendingBlob = null;
      if (dedupOfId) summary.copies++;
      else summary.inserted++;
      log.info({ public_job_id: row.id, copy_of: dedupOfId }, "pool: insertado");
    } catch (e) {
      summary.errors++;
      log.error({ err: safeDbError(e) }, "pool: error");
      if (pendingBlob) await dropBlob(db, pendingBlob).catch(() => undefined);
    }
  }
  return summary;
}
