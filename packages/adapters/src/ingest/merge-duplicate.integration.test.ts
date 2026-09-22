import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { applyMigrations } from "@job-search-os/db/src/migrate";
import { createDb, schema as s } from "@job-search-os/db";
import criteria from "@job-search-os/db/seeds/criteria.example.json";
import { rawJobFromManual } from "@job-search-os/pipeline";
import { eq } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { pgBlobStorage } from "../storage/blob";
import { attachJdText } from "./attach-jd";
import { ingestRawJob } from "./ingest-job";
import {
  dismissPossibleDuplicate,
  DuplicateMergeFailure,
  mergePossibleDuplicate,
} from "./merge-duplicate";

/**
 * JS-025 · Fusión manual de un posible duplicado (ADR-013). Acepta: fusionar a mano no pierde
 * ningún JD (las fuentes pasan con su crudo, JS-024) y "no son la misma" saca la marca.
 */
const USER = "a0000000-0000-4000-8000-000000000001";
let container: StartedPostgreSqlContainer | null = null;
let conn: ReturnType<typeof createDb>;
const logger = pino({ level: "silent" });
const deps = () => ({ db: conn.db, userId: USER, rules: criteria as never, logger });

const jd = (tag: string) =>
  `Buscamos ${tag} para una plataforma de pagos. TypeScript, Postgres y colas de mensajes. Remoto para Argentina, equipo chico, deploy continuo y guardias rotativas.`;

let n = 0;
/** Un original con JD y un aviso parecido sin JD de la misma empresa → marcado posible_duplicado. */
async function pair(opts: { company?: string } = {}) {
  n += 1;
  const company = opts.company ?? `Empresa D${n}`;
  const orig = await ingestRawJob(
    rawJobFromManual({
      url: `https://empresa-d.example/jobs/${n}`,
      title: "Backend Engineer (Pagos)",
      company,
      locationRaw: "Remoto (Argentina)",
      modality: "remoto",
      jdText: jd(`backend ${n}`),
    }),
    deps(),
  );
  const dup = await ingestRawJob(
    rawJobFromManual({
      url: `https://linkedin.com/jobs/view/90000${n}`,
      title: "Backend Engineer",
      company,
      locationRaw: "Remoto (Argentina)",
      modality: "remoto",
      jdText: null,
    }),
    deps(),
  );
  expect(dup).toMatchObject({ action: "inserted", possibleDuplicateOf: orig.jobId });
  return { origId: orig.jobId, dupId: dup.jobId };
}

const job = async (id: string) => (await conn.db.select().from(s.jobs).where(eq(s.jobs.id, id)))[0];
const sources = (id: string) =>
  conn.db.select().from(s.jobSources).where(eq(s.jobSources.jobId, id));
const apply = (jobId: string) =>
  conn.db.insert(s.applications).values({ jobId, userId: USER, appliedAt: new Date() });

beforeAll(async () => {
  let ownerUrl = process.env.DATABASE_URL;
  if (!ownerUrl) {
    container = await new PostgreSqlContainer("pgvector/pgvector:pg16")
      .withDatabase("jobsearch")
      .withUsername("postgres")
      .withPassword("postgres")
      .start();
    ownerUrl = container.getConnectionUri();
  }
  await applyMigrations(ownerUrl, { log: () => {} });
  conn = createDb(ownerUrl, { max: 2 });
  await conn.db
    .insert(s.profiles)
    .values({
      userId: USER,
      displayName: "Test",
      locationCountry: "AR",
      remoteOnly: true,
      inboundAddress: "u_a0000000@ingest.test",
      profileSummary: "AI Engineer.",
    })
    .onConflictDoNothing();
}, 180_000);

afterAll(async () => {
  await conn?.close();
  await container?.stop();
});

describe("JS-025: fusión manual de posible_duplicado", () => {
  it("caso real: el aviso sin JD se fusiona en el original, que se lleva su fuente con el crudo", async () => {
    const { origId, dupId } = await pair();
    await apply(origId); // el original tiene historia
    const dupSource = (await sources(dupId))[0]!;

    const out = await conn.db.transaction((tx) =>
      mergePossibleDuplicate(tx, { userId: USER, jobId: dupId }),
    );
    expect(out).toMatchObject({ survivorId: origId, absorbedId: dupId, enqueued: false });

    expect(await job(dupId)).toBeUndefined();
    const survivor = await job(origId);
    expect(survivor!.flags ?? []).not.toContain("posible_duplicado");
    expect(survivor!.duplicateOfId).toBeNull();
    const srcs = await sources(origId);
    expect(srcs.map((x) => x.id)).toContain(dupSource.id);
    expect(await pgBlobStorage(conn.db).get(dupSource.rawRef!)).not.toBeNull();
  });

  it("no pierde ningún JD: queda el más largo y el otro sigue accesible desde su fuente", async () => {
    const { origId, dupId } = await pair();
    const largo = `${jd("backend largo")} Además: Kubernetes, observabilidad y on-call con compensación.`;
    await attachJdText(conn.db, { userId: USER, jobId: dupId, text: largo, taxonomy: [] });
    const jdOriginal = (await job(origId))!.jdText!;

    await conn.db.transaction((tx) =>
      mergePossibleDuplicate(tx, { userId: USER, jobId: dupId, taxonomy: [] }),
    );

    const survivor = await job(origId);
    expect(survivor!.jdText).toBe(largo);
    const blobs = await Promise.all(
      (await sources(origId)).map((x) => pgBlobStorage(conn.db).get(x.rawRef!)),
    );
    const bodies = blobs.map((b) => b!.body);
    expect(bodies.some((b) => b.includes(jdOriginal))).toBe(true);
    expect(bodies.some((b) => b.includes(largo))).toBe(true);
  });

  it("si el que queda esperaba JD y la recibe, va a evaluación", async () => {
    const { origId, dupId } = await pair();
    // el marcado tiene historia y queda él; el original le pasa su JD
    await apply(dupId);
    const enqueue = vi.fn(async () => {});
    const out = await conn.db.transaction((tx) =>
      mergePossibleDuplicate(tx, {
        userId: USER,
        jobId: dupId,
        taxonomy: [],
        enqueueEvaluation: enqueue,
      }),
    );
    expect(out).toMatchObject({ survivorId: dupId, absorbedId: origId, enqueued: true });
    expect(enqueue).toHaveBeenCalledWith(dupId, USER);
    expect((await job(dupId))!.jdText).toContain("backend");
    // la URL del original no se pierde: queda como fuente
    expect((await sources(dupId)).map((x) => x.url)).toContain(
      `https://empresa-d.example/jobs/${n}`,
    );
  });

  it("los dos con historia: no toca nada", async () => {
    const { origId, dupId } = await pair();
    await apply(origId);
    await apply(dupId);
    await expect(
      conn.db.transaction((tx) => mergePossibleDuplicate(tx, { userId: USER, jobId: dupId })),
    ).rejects.toMatchObject({ code: "both_have_history" });
    expect(await job(dupId)).toBeDefined();
    expect((await job(dupId))!.flags).toContain("posible_duplicado");
  });

  it("un job sin marca no se fusiona", async () => {
    const { origId } = await pair();
    await expect(
      conn.db.transaction((tx) => mergePossibleDuplicate(tx, { userId: USER, jobId: origId })),
    ).rejects.toBeInstanceOf(DuplicateMergeFailure);
  });

  it("«no son la misma» saca la marca y el puntero, y no se puede repetir", async () => {
    const { dupId } = await pair();
    expect(await dismissPossibleDuplicate(conn.db, { userId: USER, jobId: dupId })).toBe(true);
    const row = await job(dupId);
    expect(row!.duplicateOfId).toBeNull();
    expect(row!.flags ?? []).not.toContain("posible_duplicado");
    expect(await dismissPossibleDuplicate(conn.db, { userId: USER, jobId: dupId })).toBe(false);
  });
});
