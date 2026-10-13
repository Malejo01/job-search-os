import { randomUUID } from "node:crypto";
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
import { and, eq, gte, inArray, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";
import { jdHash, upsertCompany } from "../ingest/ingest-job";
import type { Logger } from "../logger";
import { safeDbError } from "../logging/safe-error";
import { loadTaxonomy, syncPublicJobSkillsFromText, syncPublicJobSkillsMany } from "../skills/sync";
import { pgBlobStorage, type BlobStorage } from "../storage/blob";

/**
 * Upsert del pool global de ofertas (ADR-014). Corre con la conexión de servicio (dueña): la app
 * solo lee `public_jobs`. Por cada RawJob: normaliza (contactos fuera de título, empresa,
 * ubicación, JD y crudo antes de calcular o guardar nada), decide con `poolDedup` y escribe. No
 * asigna nada a usuarios: no toca `jobs` ni `job_sources`.
 * Falla cerrado: sin id, o sin URL http/https de la fuente, se salta el aviso; no se inventa nada.
 * Un error en un aviso no corta el lote.
 *
 * Se procesa en lotes de avisos consecutivos del mismo board (`chunkPoolJobs`): una consulta de
 * candidatas, dedup en memoria y escrituras multi-fila. Si la transacción de un lote falla, ese
 * lote se reintenta aviso por aviso (`upsertOne`, la ruta original).
 */
export type PoolUpsertSummary = {
  received: number;
  inserted: number;
  updated: number;
  unchanged: number;
  copies: number;
  skipped: number;
  errors: number;
  /** El lote se cortó porque `shouldStop` devolvió true o no alcanzaba el tiempo; lo que quedó sin procesar no cuenta. */
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
  /** Se consulta antes de cada lote; si devuelve true se corta (límite de tiempo). */
  shouldStop?: () => boolean;
  /** Milisegundos que quedan; si el lote estimado no entra, se corta sin empezarlo. */
  timeLeftMs?: () => number;
  /** Reloj para medir ms por aviso (tests). Por defecto `Date.now`. */
  clock?: () => number;
};

/** Máximo de avisos por lote. */
export const POOL_UPSERT_CHUNK = 100;
/** Ms por aviso que se supone antes de haber medido el primer lote. */
export const POOL_UPSERT_INITIAL_MS_PER_JOB = 15;
/** Margen de seguridad: el promedio de lotes baratos subestima a los caros. */
export const POOL_UPSERT_ESTIMATE_FACTOR = 1.5;

const ATS_KINDS = new Set(["greenhouse", "lever", "ashby"]);

/** Clave de board: en los ATS `proveedor:token`; en el resto, una fija por fuente. */
function boardKey(raw: RawJob): string {
  const kind = raw.source.kind;
  if (!ATS_KINDS.has(kind)) return kind;
  const id = raw.source.externalId?.trim() ?? "";
  return `${kind}|${id.split(":").slice(0, 2).join(":")}`;
}

/** Agrupa avisos consecutivos del mismo board, con tope de `POOL_UPSERT_CHUNK` por lote. Pura. */
export function chunkPoolJobs(raws: readonly RawJob[]): RawJob[][] {
  const chunks: RawJob[][] = [];
  let current: RawJob[] = [];
  let currentKey: string | null = null;
  for (const raw of raws) {
    const key = boardKey(raw);
    if (current.length && (key !== currentKey || current.length >= POOL_UPSERT_CHUNK)) {
      chunks.push(current);
      current = [];
    }
    currentKey = key;
    current.push(raw);
  }
  if (current.length) chunks.push(current);
  return chunks;
}

/** Tiempo estimado de un lote: avisos × promedio medido (o el inicial antes del primero). Pura. */
export function estimateBatchMs(count: number, doneMs: number, doneJobs: number): number {
  const perJob = doneJobs > 0 ? doneMs / doneJobs : POOL_UPSERT_INITIAL_MS_PER_JOB;
  return count * perJob * POOL_UPSERT_ESTIMATE_FACTOR;
}

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

/** Contactos fuera de lo que se guarda: título, empresa y ubicación además del JD y el crudo. */
function sanitize(original: RawJob): RawJob {
  return {
    ...original,
    title: stripContacts(original.title),
    companyRaw: stripContacts(original.companyRaw),
    locationRaw: original.locationRaw ? stripContacts(original.locationRaw) : null,
  };
}

/** Misma lógica de nombre visible que `upsertCompany`. */
function companyDisplayName(companyRaw: string): string {
  return companyRaw.replace(/\s*\(.*$/, "").trim() || companyRaw;
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

type Outcome = "inserted" | "updated" | "unchanged" | "copies" | "skipped" | "errors";

type Ctx = {
  db: Db;
  logger: Logger;
  now: Date;
  storage: BlobStorage;
  /** true si el crudo va por la conexión de la base (se puede meter en la transacción del lote). */
  defaultStorage: boolean;
  taxonomy: readonly Term[] | undefined;
  /** true si hay que cortar (`shouldStop` o sin tiempo); se consulta antes de cada aviso del reintento. */
  halt: () => boolean;
  /** Se cortó adentro de un lote: no se empiezan más lotes. */
  stopped: boolean;
};

async function ensureTaxonomy(ctx: Ctx): Promise<void> {
  if (!ctx.taxonomy) ctx.taxonomy = await loadTaxonomy(ctx.db);
}

/** Ruta original: un aviso, con sus propias consultas. Nunca lanza; devuelve en qué contador suma. */
async function upsertOne(ctx: Ctx, original: RawJob): Promise<Outcome> {
  const { db, logger, now, storage } = ctx;
  const log = logger.child({
    source: original.source.kind,
    external_id: original.source.externalId,
  });
  const externalId = original.source.externalId?.trim();
  const sourceUrl = original.source.url?.trim();
  if (!externalId || !sourceUrl || !isHttpUrl(sourceUrl)) return "skipped";
  const raw = sanitize(original);
  // Crudo guardado que todavía no cuelga de ninguna fila: si algo falla, se borra para no dejarlo huérfano
  let pendingBlob: string | null = null;
  try {
    const n = normalize(raw, externalId, sourceUrl);
    if (n.jdText) await ensureTaxonomy(ctx);
    const taxonomy = ctx.taxonomy;
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
          roleHints: t.roleHints,
        })
        .from(t)
        .where(eq(t.id, decision.id));
      const incoming = contentSignature({
        ...raw,
        categories: raw.categories ?? null,
        jdHash: n.hash,
      });
      if (stored && contentSignature(stored) === incoming) {
        // `role_hints` no está en la firma: si una regla nueva da otras pistas, se actualizan acá,
        // sin crudo nuevo ni `updatedAt`
        const hintsChanged = hintsDiffer(stored.roleHints, n.roleHints);
        await db
          .update(t)
          .set(hintsChanged ? { lastSeenAt: now, roleHints: n.roleHints } : { lastSeenAt: now })
          .where(eq(t.id, decision.id));
        // Una fila sin skills pero con JD (la sincronización falló antes) se rehace
        if (n.jdText && taxonomy) {
          const [{ n: have } = { n: 0 }] = await db
            .select({ n: sql<number>`count(*)::int` })
            .from(s.publicJobSkills)
            .where(eq(s.publicJobSkills.publicJobId, decision.id));
          if (!have) await syncPublicJobSkillsFromText(db, decision.id, n.jdText, taxonomy);
        }
        return "unchanged";
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
      log.info({ public_job_id: decision.id }, "pool: actualizado");
      return "updated";
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
      return "unchanged";
    }
    pendingBlob = null;
    log.info({ public_job_id: row.id, copy_of: dedupOfId }, "pool: insertado");
    return dedupOfId ? "copies" : "inserted";
  } catch (e) {
    log.error({ err: safeDbError(e) }, "pool: error");
    if (pendingBlob) await dropBlob(db, pendingBlob).catch(() => undefined);
    return "errors";
  }
}

function hintsDiffer(stored: readonly string[] | null, incoming: readonly string[]): boolean {
  return JSON.stringify([...(stored ?? [])].sort()) !== JSON.stringify([...incoming].sort());
}

type Item = { original: RawJob; raw: RawJob; n: Normalized; externalId: string };
type NewRow = { id: string; item: Item; dedupOfId: string | null };

/** Un lote: una consulta de candidatas, dedup en memoria y escrituras multi-fila. */
async function processBatch(
  ctx: Ctx,
  chunk: readonly RawJob[],
  bump: (o: Outcome) => void,
): Promise<void> {
  const { db, logger, now } = ctx;
  const items: Item[] = [];
  for (const original of chunk) {
    const externalId = original.source.externalId?.trim();
    const sourceUrl = original.source.url?.trim();
    if (!externalId || !sourceUrl || !isHttpUrl(sourceUrl)) {
      bump("skipped");
      continue;
    }
    try {
      const raw = sanitize(original);
      items.push({ original, raw, n: normalize(raw, externalId, sourceUrl), externalId });
    } catch (e) {
      logger
        .child({ source: original.source.kind, external_id: externalId })
        .error({ err: safeDbError(e) }, "pool: error");
      bump("errors");
    }
  }
  if (!items.length) return;

  const fallback = async (list: readonly Item[]) => {
    for (const it of list) {
      if (ctx.stopped || ctx.halt()) {
        // Lo que no se recorre no suma ningún contador
        ctx.stopped = true;
        return;
      }
      bump(await upsertOne(ctx, it.original));
    }
  };

  // 1. Candidatas de todo el lote en una consulta
  const t = s.publicJobs;
  type Stored = {
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
    roleHints: string[] | null;
  };
  const recent: PoolRecent[] = [];
  const storedById = new Map<string, Stored>();
  try {
    if (items.some((i) => i.n.jdText)) await ensureTaxonomy(ctx);
    const since = new Date(now.getTime() - WINDOW_DAYS * DAY_MS);
    const idsByKind = new Map<string, Set<string>>();
    for (const i of items) {
      const k = i.raw.source.kind;
      if (!idsByKind.has(k)) idsByKind.set(k, new Set());
      idsByKind.get(k)!.add(i.externalId);
    }
    const urls = [...new Set(items.flatMap((i) => (i.n.canonical ? [i.n.canonical] : [])))];
    const hashes = [...new Set(items.flatMap((i) => (i.n.hash ? [i.n.hash] : [])))];
    const companies = [
      ...new Set(items.flatMap((i) => (i.n.companyNormalized ? [i.n.companyNormalized] : []))),
    ];
    const conds: (SQL | undefined)[] = [
      ...[...idsByKind].map(([kind, ids]) =>
        and(eq(t.sourceKind, kind as never), inArray(t.externalId, [...ids])),
      ),
      urls.length ? inArray(t.canonicalUrl, urls) : undefined,
      hashes.length ? inArray(t.jdHash, hashes) : undefined,
      companies.length
        ? and(
            inArray(t.companyNormalized, companies),
            gte(t.firstSeenAt, since),
            isNotNull(t.jdShingles),
          )
        : undefined,
    ];
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
        roleHints: t.roleHints,
      })
      .from(t)
      .where(or(...conds));
    for (const r of rows) {
      recent.push({
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
      });
      storedById.set(r.id, r);
    }
  } catch (e) {
    logger.error({ err: safeDbError(e) }, "pool: error al cargar candidatas del lote");
    await fallback(items);
    return;
  }

  // 2. Dedup en memoria, en orden: las filas nuevas del lote entran como candidatas
  const unchangedItems: { id: string; item: Item }[] = [];
  const changedItems: Item[] = [];
  const newRows: NewRow[] = [];
  const batchIds = new Set<string>();
  for (const item of items) {
    const { raw, n, externalId } = item;
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
      if (batchIds.has(decision.id)) {
        // Repetido dentro del mismo lote: la primera aparición ya es la fila nueva
        bump("unchanged");
        continue;
      }
      const stored = storedById.get(decision.id);
      const incoming = contentSignature({
        ...raw,
        categories: raw.categories ?? null,
        jdHash: n.hash,
      });
      if (stored && contentSignature(stored) === incoming) {
        unchangedItems.push({ id: decision.id, item });
      } else {
        changedItems.push(item);
      }
      continue;
    }
    const id = randomUUID();
    const dedupOfId = decision.kind === "copy_of" ? decision.id : null;
    newRows.push({ id, item, dedupOfId });
    batchIds.add(id);
    recent.push({
      id,
      sourceKind: raw.source.kind,
      externalId,
      canonicalUrl: n.canonical,
      jdHash: n.hash,
      jdShingles: n.shingles,
      companyNormalized: n.companyNormalized,
      seenAt: now,
      firstSeenAt: now,
      dedupOfId,
    });
  }

  // 3. Sin cambios: un update de last_seen_at, pistas individuales y reparación de skills
  if (unchangedItems.length) {
    try {
      const ids = [...new Set(unchangedItems.map((u) => u.id))];
      await db.update(t).set({ lastSeenAt: now }).where(inArray(t.id, ids));
      const hinted = new Map<string, string[]>();
      for (const u of unchangedItems) {
        if (hintsDiffer(storedById.get(u.id)?.roleHints ?? null, u.item.n.roleHints)) {
          hinted.set(u.id, u.item.n.roleHints);
        }
      }
      for (const [id, roleHints] of hinted) {
        await db.update(t).set({ lastSeenAt: now, roleHints }).where(eq(t.id, id));
      }
      const withJd = unchangedItems.filter((u) => u.item.n.jdText);
      if (withJd.length && ctx.taxonomy) {
        const have = await db
          .select({ id: s.publicJobSkills.publicJobId, n: sql<number>`count(*)::int` })
          .from(s.publicJobSkills)
          .where(inArray(s.publicJobSkills.publicJobId, [...new Set(withJd.map((u) => u.id))]))
          .groupBy(s.publicJobSkills.publicJobId);
        const withSkills = new Set(have.map((h) => h.id));
        const repaired = new Set<string>();
        for (const u of withJd) {
          if (withSkills.has(u.id) || repaired.has(u.id)) continue;
          repaired.add(u.id);
          await syncPublicJobSkillsFromText(db, u.id, u.item.n.jdText!, ctx.taxonomy);
        }
      }
      for (let i = 0; i < unchangedItems.length; i++) bump("unchanged");
    } catch (e) {
      logger.error({ err: safeDbError(e) }, "pool: error en avisos sin cambios del lote");
      await fallback(unchangedItems.map((u) => u.item));
    }
  }

  // 4. Cambiados: ruta aviso por aviso
  await fallback(changedItems);

  // 5. Nuevos (raíces y copias): una transacción por lote
  if (!newRows.length || ctx.stopped) return;
  // Crudos ya guardados por un storage inyectado antes de la transacción. Con uno que no sea pg,
  // `dropBlob` no los borra si el lote falla (solo limpia refs `pg:`). Hoy no aplica: el storage
  // por defecto inserta los crudos dentro de la transacción y se deshacen con ella.
  const externalRefs: string[] = [];
  try {
    const taxonomy = ctx.taxonomy;
    const inputs = newRows.map((r) => ({
      userId: null,
      kind: `pool_${r.item.raw.source.kind}`,
      ...rawPayload(r.item.raw),
    }));
    const results = await db.transaction(async (tx) => {
      const txDb = tx as unknown as Db;
      // Crudos: con el storage por defecto van dentro de la transacción (si falla, no quedan huérfanos)
      let refs: string[];
      if (ctx.defaultStorage) {
        refs = await pgBlobStorage(txDb).putMany!(inputs);
      } else if (ctx.storage.putMany) {
        refs = await ctx.storage.putMany(inputs);
        externalRefs.push(...refs);
      } else {
        refs = [];
        for (const input of inputs) {
          const ref = await ctx.storage.put(input);
          refs.push(ref);
          externalRefs.push(ref);
        }
      }

      // Empresas: un insert multi-fila y un select por ANY
      const names = new Map<string, string>();
      for (const r of newRows) {
        const norm = r.item.n.companyNormalized;
        if (norm && !names.has(norm)) names.set(norm, companyDisplayName(r.item.raw.companyRaw));
      }
      const companyIds = new Map<string, string>();
      if (names.size) {
        await txDb
          .insert(s.companies)
          .values(
            [...names].map(([nameNormalized, displayName]) => ({ nameNormalized, displayName })),
          )
          .onConflictDoNothing({ target: s.companies.nameNormalized });
        const found = await txDb
          .select({ id: s.companies.id, name: s.companies.nameNormalized })
          .from(s.companies)
          .where(inArray(s.companies.nameNormalized, [...names.keys()]));
        for (const f of found) companyIds.set(f.name, f.id);
      }

      const valuesOf = (r: NewRow, idx: number, dedupOfId: string | null) => ({
        id: r.id,
        sourceKind: r.item.raw.source.kind,
        externalId: r.item.externalId,
        ...contentColumns(r.item.raw, r.item.n, companyIds.get(r.item.n.companyNormalized) ?? null),
        firstSeenAt: now,
        lastSeenAt: now,
        dedupOfId,
        rawRef: refs[idx]!,
      });
      const insertRows = async (list: { r: NewRow; idx: number; dedupOfId: string | null }[]) => {
        if (!list.length) return [];
        return txDb
          .insert(s.publicJobs)
          .values(list.map((x) => valuesOf(x.r, x.idx, x.dedupOfId)))
          .onConflictDoUpdate({
            target: [s.publicJobs.sourceKind, s.publicJobs.externalId],
            set: { lastSeenAt: now },
          })
          .returning({
            id: s.publicJobs.id,
            sourceKind: s.publicJobs.sourceKind,
            externalId: s.publicJobs.externalId,
            created: sql<boolean>`(xmax = 0)`,
          });
      };
      const all = newRows.map((r, idx) => ({ r, idx }));
      const roots = all.filter((x) => !x.r.dedupOfId || !batchIds.has(x.r.dedupOfId));
      const copies = all.filter((x) => x.r.dedupOfId && batchIds.has(x.r.dedupOfId));

      const out: { row: NewRow; ref: string; id: string; created: boolean }[] = [];
      const realId = new Map<string, string>();
      const collect = (
        returned: { id: string; sourceKind: string; externalId: string; created: boolean }[],
        list: { r: NewRow; idx: number }[],
      ) => {
        const byKey = new Map(returned.map((x) => [`${x.sourceKind}|${x.externalId}`, x]));
        for (const x of list) {
          const hit = byKey.get(`${x.r.item.raw.source.kind}|${x.r.item.externalId}`)!;
          realId.set(x.r.id, hit.id);
          out.push({ row: x.r, ref: refs[x.idx]!, id: hit.id, created: hit.created });
        }
      };
      collect(await insertRows(roots.map((x) => ({ ...x, dedupOfId: x.r.dedupOfId }))), roots);
      collect(
        await insertRows(
          copies.map((x) => ({ ...x, dedupOfId: realId.get(x.r.dedupOfId!) ?? x.r.dedupOfId })),
        ),
        copies,
      );

      // Skills solo de las filas creadas en esta transacción
      if (taxonomy) {
        const skillItems = out
          .filter((o) => o.created && o.row.item.n.jdText)
          .map((o) => ({ publicJobId: o.id, text: o.row.item.n.jdText! }));
        if (skillItems.length) await syncPublicJobSkillsMany(txDb, skillItems, taxonomy);
      }
      return out;
    });

    for (const o of results) {
      const log = logger.child({
        source: o.row.item.raw.source.kind,
        external_id: o.row.item.externalId,
      });
      if (!o.created) {
        // Otra corrida lo insertó antes: el crudo recién guardado sobra
        await dropBlob(db, o.ref).catch(() => undefined);
        bump("unchanged");
        continue;
      }
      const copyOf = o.row.dedupOfId;
      log.info({ public_job_id: o.id, copy_of: copyOf }, "pool: insertado");
      bump(copyOf ? "copies" : "inserted");
    }
    logger.info(
      {
        avisos: chunk.length,
        nuevos: results.filter((o) => o.created).length,
        sin_cambios: unchangedItems.length,
        cambiados: changedItems.length,
      },
      "pool: lote",
    );
  } catch (e) {
    logger.error(
      { err: safeDbError(e) },
      "pool: error en la transacción del lote; se reintenta uno por uno",
    );
    for (const ref of externalRefs) await dropBlob(db, ref).catch(() => undefined);
    await fallback(newRows.map((r) => r.item));
  }
}

export async function upsertPoolJobs(
  raws: readonly RawJob[],
  deps: PoolUpsertDeps,
): Promise<PoolUpsertSummary> {
  const { db } = deps;
  const clock = deps.clock ?? Date.now;
  const ctx: Ctx = {
    db,
    logger: deps.logger,
    now: deps.now?.() ?? new Date(),
    storage: deps.storage ?? pgBlobStorage(db),
    defaultStorage: !deps.storage,
    taxonomy: deps.taxonomy,
    halt: () => Boolean(deps.shouldStop?.()) || (deps.timeLeftMs ? deps.timeLeftMs() <= 0 : false),
    stopped: false,
  };
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
  const bump = (o: Outcome) => {
    summary[o]++;
  };

  let doneMs = 0;
  let doneJobs = 0;
  for (const chunk of chunkPoolJobs(raws)) {
    if (deps.shouldStop?.()) {
      summary.stopped = true;
      break;
    }
    if (deps.timeLeftMs && estimateBatchMs(chunk.length, doneMs, doneJobs) > deps.timeLeftMs()) {
      summary.stopped = true;
      break;
    }
    const start = clock();
    await processBatch(ctx, chunk, bump);
    doneMs += clock() - start;
    doneJobs += chunk.length;
    if (ctx.stopped) {
      summary.stopped = true;
      break;
    }
  }
  return summary;
}
