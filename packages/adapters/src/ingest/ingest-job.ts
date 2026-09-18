import { createHash } from "node:crypto";
import { schema as s, type Db } from "@job-search-os/db";
import {
  canonicalUrl,
  dedup,
  externalKey,
  normalizeCompany,
  normalizeTitle,
  prefilter,
  textShingles,
  titleTokens,
  transition,
  type CriteriaRules,
  type DedupReason,
  type JobStatus,
  type RawJob,
  type RecentJob,
  type Term,
} from "@job-search-os/pipeline";
import { syncJobSkillsFromText } from "../skills/sync";
import { pgBlobStorage, type BlobStorage } from "../storage/blob";
import { and, eq, gte, inArray, isNotNull, sql, type SQL } from "drizzle-orm";
import type { Logger } from "../logger";

/**
 * Ingesta de un RawJob para un usuario: normaliza → dedup contra los últimos 14 días →
 * (merge: suma la fuente, conserva fecha más antigua y texto más largo) | (insert: empresa,
 * prefiltro, estado, cola de evaluación si hay JD; si dedup lo marcó como posible duplicado,
 * `duplicate_of_id` + flag `posible_duplicado`, sin fusionar: ADR-013). Antes de todo, el crudo
 * de la carga va a raw_blobs y cada job_sources apunta a él (JS-024). Toda la lógica de decisión está en
 * packages/pipeline; acá solo hay I/O y orquestación. Corre como servicio (dueño con
 * BYPASSRLS) y filtra por user_id explícito (ARCHITECTURE §4).
 */
export type IngestDeps = {
  db: Db;
  userId: string;
  rules: CriteriaRules;
  logger: Logger;
  /** Encola la evaluación LLM (JS-013). Si no está, el job queda prefiltrado sin evaluar. */
  enqueueEvaluation?: (jobId: string, userId: string) => Promise<void>;
  now?: () => Date;
  windowDays?: number;
  /** Taxonomía compilada (loadTaxonomy): si está, job_skills se rellena desde la JD sin LLM (pre-score offline). */
  taxonomy?: readonly Term[];
  /** Dónde va el crudo (JS-024). Por defecto raw_blobs en la misma conexión. */
  storage?: BlobStorage;
};

export type IngestOutcome =
  | {
      action: "merged";
      jobId: string;
      reason: DedupReason;
      sourceAdded: boolean;
    }
  | {
      action: "inserted";
      jobId: string;
      status: JobStatus;
      prefilterReason: string | null;
      enqueued: boolean;
      /** Job parecido (misma empresa y título) que dedup no se animó a fusionar */
      possibleDuplicateOf: string | null;
    };

const DAY_MS = 24 * 60 * 60 * 1000;

export function jdHash(text: string): string {
  return createHash("sha256").update(text.trim().replace(/\s+/g, " ").toLowerCase()).digest("hex");
}

/** Jobs del usuario en la ventana de dedup, con sus claves externas. */
async function loadRecentJobs(db: Db, userId: string, since: Date): Promise<RecentJob[]> {
  const rows = await db
    .select({
      id: s.jobs.id,
      canonicalUrl: s.jobs.canonicalUrl,
      companyRaw: s.jobs.companyRaw,
      titleNormalized: s.jobs.titleNormalized,
      jdShingles: s.jobs.jdShingles,
      jdHash: s.jobs.jdHash,
      firstSeenAt: s.jobs.firstSeenAt,
    })
    .from(s.jobs)
    .where(and(eq(s.jobs.userId, userId), gte(s.jobs.firstSeenAt, since)));
  if (!rows.length) return [];
  const sources = await db
    .select({
      jobId: s.jobSources.jobId,
      kind: s.jobSources.kind,
      externalId: s.jobSources.externalId,
    })
    .from(s.jobSources)
    .where(
      inArray(
        s.jobSources.jobId,
        rows.map((r) => r.id),
      ),
    );
  const keys = new Map<string, string[]>();
  for (const src of sources) {
    const k = externalKey(src.kind, src.externalId);
    if (k) keys.set(src.jobId, [...(keys.get(src.jobId) ?? []), k]);
  }
  return rows.map((r) => ({
    id: r.id,
    canonicalUrl: r.canonicalUrl,
    externalIds: keys.get(r.id) ?? [],
    companyNormalized: normalizeCompany(r.companyRaw),
    titleTokens: r.titleNormalized.split(" ").filter(Boolean),
    jdShingles: r.jdShingles,
    jdHash: r.jdHash,
    firstSeenAt: r.firstSeenAt,
  }));
}

/** Misma fuente: mismo tipo y mismo id externo o, si no tiene, la misma URL. */
function sameSourceKey(raw: RawJob): SQL {
  if (raw.source.externalId) return eq(s.jobSources.externalId, raw.source.externalId);
  if (raw.source.url) return eq(s.jobSources.url, raw.source.url);
  return sql`false`;
}

/**
 * Crudo de la carga (JS-024), antes de dedup y de cualquier escritura en jobs: el payload
 * original de la fuente o, si el adapter no lo trae, el RawJob tal como entró. Si ya viene
 * guardado (el email entero), se usa esa ref. Si esta misma fuente ya llegó con exactamente el
 * mismo contenido (el cron de GoB re-trae los mismos avisos cada 6 h), se reusa el blob.
 */
async function persistRaw(
  db: Db,
  storage: BlobStorage,
  userId: string,
  raw: RawJob,
): Promise<string> {
  if (raw.source.rawRef) return raw.source.rawRef;
  const { original, ...source } = raw.source;
  const payload = original ?? {
    contentType: "application/json",
    body: JSON.stringify({ ...raw, source }),
  };
  const seen = await db
    .select({ rawRef: s.jobSources.rawRef })
    .from(s.jobSources)
    .innerJoin(s.jobs, eq(s.jobs.id, s.jobSources.jobId))
    .where(
      and(
        eq(s.jobs.userId, userId),
        eq(s.jobSources.kind, raw.source.kind),
        sameSourceKey(raw),
        isNotNull(s.jobSources.rawRef),
      ),
    );
  for (const { rawRef } of seen) {
    const blob = await storage.get(rawRef!);
    if (blob && blob.body === payload.body && blob.contentType === payload.contentType)
      return rawRef!;
  }
  return storage.put({
    userId,
    kind: `ingest_${raw.source.kind}`,
    contentType: payload.contentType,
    body: payload.body,
  });
}

async function upsertCompany(db: Db, companyRaw: string): Promise<string | null> {
  const nameNormalized = normalizeCompany(companyRaw);
  if (!nameNormalized) return null;
  await db
    .insert(s.companies)
    .values({
      nameNormalized,
      displayName: companyRaw.replace(/\s*\(.*$/, "").trim() || companyRaw,
    })
    .onConflictDoNothing({ target: s.companies.nameNormalized });
  const [row] = await db
    .select({ id: s.companies.id })
    .from(s.companies)
    .where(eq(s.companies.nameNormalized, nameNormalized))
    .limit(1);
  return row?.id ?? null;
}

export async function ingestRawJob(raw: RawJob, deps: IngestDeps): Promise<IngestOutcome> {
  const { db, userId, rules } = deps;
  const now = deps.now?.() ?? new Date();
  const since = new Date(now.getTime() - (deps.windowDays ?? 14) * DAY_MS);
  const log = deps.logger.child({
    user_id: userId,
    source: raw.source.kind,
    external_id: raw.source.externalId,
  });

  const url = raw.source.url ? canonicalUrl(raw.source.url) : null;
  const canonical = url?.ok ? url.value : null;
  const shingles = raw.jdText ? textShingles(raw.jdText) : null;
  const hash = raw.jdText ? jdHash(raw.jdText) : null;
  const seenAt = raw.postedAt ?? now;

  // JS-024: el crudo primero; si algo de lo que sigue falla, igual queda guardado
  const rawRef = await persistRaw(db, deps.storage ?? pgBlobStorage(db), userId, raw);

  const recent = await loadRecentJobs(db, userId, since);
  const decision = dedup(
    {
      canonicalUrl: canonical,
      sourceKind: raw.source.kind,
      externalId: raw.source.externalId,
      companyNormalized: normalizeCompany(raw.companyRaw),
      titleTokens: titleTokens(raw.title),
      jdShingles: shingles,
      jdHash: hash,
      seenAt,
    },
    recent,
  );

  if (decision.kind === "merge") {
    const [existing] = await db
      .select({
        id: s.jobs.id,
        jdText: s.jobs.jdText,
        firstSeenAt: s.jobs.firstSeenAt,
        flags: s.jobs.flags,
        status: s.jobs.status,
      })
      .from(s.jobs)
      .where(eq(s.jobs.id, decision.jobId))
      .limit(1);
    if (!existing) throw new Error(`dedup apuntó a un job inexistente: ${decision.jobId}`);

    // Misma fuente ya registrada: con el mismo crudo no se agrega nada; sin crudo (anterior a
    // JS-024) se completa; con un crudo propio distinto (el aviso cambió) va una fila nueva, así
    // ninguna versión queda sin acceso. Un crudo externo (el email entero) no cuenta como versión.
    const sameSource = await db
      .select({ id: s.jobSources.id, rawRef: s.jobSources.rawRef })
      .from(s.jobSources)
      .where(
        and(
          eq(s.jobSources.jobId, existing.id),
          eq(s.jobSources.kind, raw.source.kind),
          sameSourceKey(raw),
        ),
      );
    const legacy = sameSource.find((x) => x.rawRef === null);
    const known =
      sameSource.some((x) => x.rawRef === rawRef) ||
      (Boolean(raw.source.rawRef) && sameSource.length > 0 && !legacy);
    let sourceAdded = false;
    if (known) {
      // nada que agregar
    } else if (legacy) {
      await db.update(s.jobSources).set({ rawRef }).where(eq(s.jobSources.id, legacy.id));
    } else {
      await db.insert(s.jobSources).values({
        jobId: existing.id,
        kind: raw.source.kind,
        sourceName: raw.source.name,
        externalId: raw.source.externalId,
        url: raw.source.url,
        rawRef,
        seenAt,
      });
      sourceAdded = true;
    }

    // Fusión (ADR-006): fecha más antigua, texto más largo, flags acumulados
    const longerJd =
      raw.jdText && raw.jdText.length > (existing.jdText?.length ?? 0) ? raw.jdText : null;
    const flags = [...new Set([...(existing.flags ?? []), ...decision.flags])];
    await db
      .update(s.jobs)
      .set({
        firstSeenAt: seenAt < existing.firstSeenAt ? seenAt : existing.firstSeenAt,
        flags,
        updatedAt: now,
        ...(longerJd
          ? { jdText: longerJd, jdHash: jdHash(longerJd), jdShingles: textShingles(longerJd) }
          : {}),
        ...(canonical && !recent.find((r) => r.id === existing.id)?.canonicalUrl
          ? { canonicalUrl: canonical }
          : {}),
      })
      .where(eq(s.jobs.id, existing.id));

    if (longerJd && deps.taxonomy)
      await syncJobSkillsFromText(db, existing.id, longerJd, deps.taxonomy);

    // Si estaba esperando JD y ahora la tiene, va a evaluación
    let enqueued = false;
    if (longerJd && existing.status === "pendiente_jd" && deps.enqueueEvaluation) {
      await deps.enqueueEvaluation(existing.id, userId);
      enqueued = true;
    }
    log.info(
      {
        job_id: existing.id,
        reason: decision.reason,
        similarity: decision.similarity,
        source_added: sourceAdded,
        enqueued,
      },
      "ingest: merge",
    );
    return { action: "merged", jobId: existing.id, reason: decision.reason, sourceAdded };
  }

  // Insert: empresa, prefiltro y estado
  const companyId = await upsertCompany(db, raw.companyRaw);
  const pre = prefilter(
    {
      title: raw.title,
      companyRaw: raw.companyRaw,
      locationRaw: raw.locationRaw,
      modality: raw.modality,
      badges: raw.badges,
      candidatesCount: raw.candidatesCount,
      countriesAllowed: raw.countriesAllowed,
    },
    rules,
  );

  let status: JobStatus = transition("nueva", pre.pass ? "prefilter_pass" : "prefilter_discard");
  const possibleDuplicateOf = decision.possibleDuplicateOf?.jobId ?? null;
  const flags = [
    ...(pre.pass ? [...pre.flags, ...(pre.cap !== null ? [`title_cap:${pre.cap}`] : [])] : []),
    ...(possibleDuplicateOf ? ["posible_duplicado"] : []),
  ];
  if (pre.pass && !raw.jdText) status = transition(status, "needs_jd");

  const [inserted] = await db
    .insert(s.jobs)
    .values({
      userId,
      companyId,
      companyRaw: raw.companyRaw,
      title: raw.title,
      titleNormalized: normalizeTitle(raw.title),
      canonicalUrl: canonical,
      locationRaw: raw.locationRaw,
      countriesAllowed: raw.countriesAllowed,
      modality: raw.modality,
      contractType: raw.contractType,
      salaryMinUsd: raw.salaryMinUsd,
      salaryMaxUsd: raw.salaryMaxUsd,
      salaryPeriod: raw.salaryPeriod,
      salaryNote: raw.salaryNote,
      weeklyHours: raw.weeklyHours,
      candidatesCount: raw.candidatesCount,
      badges: raw.badges,
      jdText: raw.jdText,
      jdHash: hash,
      jdShingles: shingles,
      postedAt: raw.postedAt,
      firstSeenAt: seenAt,
      status,
      prefilterReason: pre.pass ? null : `${pre.reason}: ${pre.detail}`,
      flags,
      duplicateOfId: possibleDuplicateOf,
    })
    .returning({ id: s.jobs.id });
  const jobId = inserted!.id;

  await db.insert(s.jobSources).values({
    jobId,
    kind: raw.source.kind,
    sourceName: raw.source.name,
    externalId: raw.source.externalId,
    url: raw.source.url,
    rawRef,
    seenAt,
  });

  if (raw.jdText && deps.taxonomy)
    await syncJobSkillsFromText(db, jobId, raw.jdText, deps.taxonomy);

  let enqueued = false;
  if (status === "prefiltrada" && deps.enqueueEvaluation) {
    await deps.enqueueEvaluation(jobId, userId);
    enqueued = true;
  }
  log.info(
    {
      job_id: jobId,
      status,
      prefilter: pre.pass ? "pass" : pre.reason,
      enqueued,
      possible_duplicate_of: possibleDuplicateOf,
      title_similarity: decision.possibleDuplicateOf?.similarity,
    },
    "ingest: insert",
  );
  return {
    action: "inserted",
    jobId,
    status,
    prefilterReason: pre.pass ? null : pre.reason,
    enqueued,
    possibleDuplicateOf,
  };
}

export type IngestSummary = {
  received: number;
  inserted: number;
  merged: number;
  byStatus: Record<string, number>;
  enqueued: number;
  errors: { externalId: string | null; error: string }[];
};

/** Ingesta un lote; un error en un job no frena el resto. */
export async function ingestBatch(raws: RawJob[], deps: IngestDeps): Promise<IngestSummary> {
  const summary: IngestSummary = {
    received: raws.length,
    inserted: 0,
    merged: 0,
    byStatus: {},
    enqueued: 0,
    errors: [],
  };
  for (const raw of raws) {
    try {
      const out = await ingestRawJob(raw, deps);
      if (out.action === "merged") summary.merged++;
      else {
        summary.inserted++;
        summary.byStatus[out.status] = (summary.byStatus[out.status] ?? 0) + 1;
        if (out.enqueued) summary.enqueued++;
      }
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      deps.logger.error({ external_id: raw.source.externalId, err: error }, "ingest: error");
      summary.errors.push({ externalId: raw.source.externalId, error });
    }
  }
  return summary;
}
