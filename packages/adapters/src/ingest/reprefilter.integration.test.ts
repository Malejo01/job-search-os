import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { applyMigrations } from "@job-search-os/db/src/migrate";
import { createDb, schema as s } from "@job-search-os/db";
import criteria from "@job-search-os/db/seeds/criteria.example.json";
import { and, eq, inArray, sql } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadProfilePrefilterPrefs } from "./ingest-job";
import { prefilterPrefsChanged, reprefilterJobs } from "./reprefilter";

/**
 * Ronda 91 · Al cambiar el perfil, los avisos sin evaluar se vuelven a prefiltrar: la persona que
 * pasa a aceptar híbrido recupera los híbridos descartados (y se encolan); la que pasa a solo
 * remoto pierde los híbridos sin evaluar. `evaluada` y los avisos de otra persona no se tocan.
 */
const A = "a9100000-0000-4000-8000-000000000001";
const B = "a9100000-0000-4000-8000-000000000002";
const USERS = [A, B];

let container: StartedPostgreSqlContainer | null = null;
let conn: ReturnType<typeof createDb>;
const logger = pino({ level: "silent" });

async function addJob(
  userId: string,
  slug: string,
  over: Partial<typeof s.jobs.$inferInsert> = {},
): Promise<string> {
  const [row] = await conn.db
    .insert(s.jobs)
    .values({
      userId,
      companyRaw: "Empresa A",
      title: "Backend Engineer",
      titleNormalized: "backend engineer",
      canonicalUrl: `https://empresa-a.example/jobs/${slug}`,
      locationRaw: "Buenos Aires",
      modality: "hibrido",
      jdText: "Buscamos backend engineer con TypeScript, Postgres y colas. Modalidad híbrida.",
      status: "descartada_prefiltro",
      prefilterReason: "modalidad_no_remota: híbrida",
      flags: ["posible_duplicado"],
      ...over,
    })
    .returning({ id: s.jobs.id });
  return row!.id;
}

const jobOf = async (id: string) =>
  (await conn.db.select().from(s.jobs).where(eq(s.jobs.id, id)))[0]!;

const queuedFor = async (jobId: string) =>
  (
    await conn.db
      .select({ id: s.jobQueue.id })
      .from(s.jobQueue)
      .where(sql`${s.jobQueue.payload}->>'jobId' = ${jobId}`)
  ).length;

async function setProfile(userId: string, acceptedModalities: string[], remoteOnly: boolean) {
  await conn.db
    .update(s.profiles)
    .set({ acceptedModalities, remoteOnly })
    .where(eq(s.profiles.userId, userId));
}

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
  await conn.db.delete(s.jobQueue).where(inArray(s.jobQueue.userId, USERS));
  await conn.db.delete(s.jobs).where(inArray(s.jobs.userId, USERS));
  await conn.db.delete(s.evaluationCriteria).where(inArray(s.evaluationCriteria.userId, USERS));
  await conn.db.delete(s.profiles).where(inArray(s.profiles.userId, USERS));
  await conn.db.delete(s.users).where(inArray(s.users.id, USERS));
  await conn.db
    .insert(s.users)
    .values(USERS.map((id, i) => ({ id, email: `u${i}@reprefiltro.test`, passwordHash: "x" })));
  await conn.db.insert(s.profiles).values(
    USERS.map((userId) => ({
      userId,
      displayName: "Test",
      locationCountry: "AR",
      remoteOnly: true,
      acceptedModalities: ["remoto"],
      inboundAddress: `rp_${userId.slice(-1)}@ingest.test`,
      profileSummary: "Backend Engineer.",
    })),
  );
  await conn.db
    .insert(s.evaluationCriteria)
    .values(USERS.map((userId) => ({ userId, version: 1, active: true, rules: criteria as never })));
}, 180_000);

afterAll(async () => {
  if (conn) {
    await conn.db.delete(s.jobQueue).where(inArray(s.jobQueue.userId, USERS));
    await conn.db.delete(s.jobs).where(inArray(s.jobs.userId, USERS));
    await conn.db.delete(s.evaluationCriteria).where(inArray(s.evaluationCriteria.userId, USERS));
    await conn.db.delete(s.profiles).where(inArray(s.profiles.userId, USERS));
    await conn.db.delete(s.users).where(inArray(s.users.id, USERS));
  }
  await conn?.close();
  await container?.stop();
});

describe("Ronda 91: re-prefiltro al cambiar el perfil", () => {
  it("acepta híbrido: el híbrido descartado vuelve, queda prefiltrado y encolado; los flags ajenos se conservan", async () => {
    const hibrido = await addJob(A, "hibrido-1");
    const otroUsuario = await addJob(B, "hibrido-otro");
    await setProfile(A, ["remoto", "hibrido"], false);

    const res = await reprefilterJobs(conn.db, A, { logger });
    expect(res).toMatchObject({ changed: 1, recovered: 1, discarded: 0, enqueued: 1 });

    const job = await jobOf(hibrido);
    expect(job.status).toBe("prefiltrada");
    expect(job.prefilterReason).toBeNull();
    expect(job.flags).toEqual(expect.arrayContaining(["posible_duplicado", "modalidad_no_remota"]));
    expect(await queuedFor(hibrido)).toBe(1);

    // otro usuario: ni estado ni cola
    expect((await jobOf(otroUsuario)).status).toBe("descartada_prefiltro");
    expect(await queuedFor(otroUsuario)).toBe(0);
  });

  it("es idempotente: una segunda corrida con el mismo perfil no cambia nada ni duplica la cola", async () => {
    const [hibrido] = await conn.db
      .select({ id: s.jobs.id })
      .from(s.jobs)
      .where(and(eq(s.jobs.userId, A), eq(s.jobs.status, "prefiltrada")));
    const res = await reprefilterJobs(conn.db, A, { logger });
    expect(res).toMatchObject({ changed: 0, recovered: 0, discarded: 0, enqueued: 0 });
    expect(await queuedFor(hibrido!.id)).toBe(1);
  });

  it("pasa a solo remoto: el híbrido sin evaluar queda descartado con su motivo; uno evaluado no se toca", async () => {
    const evaluada = await addJob(A, "hibrido-evaluada", {
      status: "evaluada",
      prefilterReason: null,
      flags: ["modalidad_no_remota"],
    });
    const pendiente = await addJob(A, "hibrido-pendiente", {
      status: "pendiente_jd",
      jdText: null,
      prefilterReason: null,
      flags: ["modalidad_no_remota"],
    });
    const remoto = await addJob(A, "remoto-1", {
      modality: "remoto",
      status: "prefiltrada",
      prefilterReason: null,
      flags: [],
    });
    await setProfile(A, ["remoto"], true);

    const res = await reprefilterJobs(conn.db, A, { logger });
    expect(res.discarded).toBe(2);
    expect(res.recovered).toBe(0);

    for (const id of [pendiente]) {
      const job = await jobOf(id);
      expect(job.status).toBe("descartada_prefiltro");
      expect(job.prefilterReason).toMatch(/^modalidad_no_remota/);
    }
    const ev = await jobOf(evaluada);
    expect(ev.status).toBe("evaluada");
    expect(ev.flags).toEqual(["modalidad_no_remota"]);
    expect((await jobOf(remoto)).status).toBe("prefiltrada");
  });

  it("prefilterPrefsChanged: detecta modalidad, país, ciudad e idioma; ignora el orden", async () => {
    const base = await loadProfilePrefilterPrefs(conn.db, A);
    expect(prefilterPrefsChanged(base, { ...base })).toBe(false);
    expect(
      prefilterPrefsChanged(base, {
        ...base,
        acceptedModalities: ["hibrido", "remoto", "presencial"],
      }),
    ).toBe(true);
    expect(prefilterPrefsChanged(base, { ...base, country: "ES" })).toBe(true);
    expect(prefilterPrefsChanged(base, { ...base, city: "Córdoba" })).toBe(true);
    expect(prefilterPrefsChanged(base, { ...base, jobLanguages: ["es"] })).toBe(true);
    expect(
      prefilterPrefsChanged(
        { ...base, jobLanguages: ["es", "en"] },
        { ...base, jobLanguages: ["en", "es"] },
      ),
    ).toBe(false);
  });
});
