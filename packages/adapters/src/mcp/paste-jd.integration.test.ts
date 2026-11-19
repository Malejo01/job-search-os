import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { applyMigrations } from "@job-search-os/db/src/migrate";
import { createDb, schema as s } from "@job-search-os/db";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { attachJdText, JdNotPendingError } from "../ingest/attach-jd";

/**
 * paste_jd del MCP solo escribe sobre ofertas que esperan su JD (`onlyPending`). La condición va
 * en la misma sentencia que escribe. Datos inventados.
 */
const A = "a5100000-0000-4000-8000-000000000001";
const B = "b5100000-0000-4000-8000-000000000002";
const ORIGINAL = "Descripción original del aviso. ".repeat(10);
const PASTED = (tag: string) => `Descripción pegada ${tag}. `.repeat(20);

type Status = (typeof s.jobs.$inferInsert)["status"];

let container: StartedPostgreSqlContainer | null = null;
let conn: ReturnType<typeof createDb>;
let seq = 0;

async function seedUser(userId: string, tag: string) {
  await conn.db
    .insert(s.profiles)
    .values({
      userId,
      displayName: `Persona ${tag}`,
      locationCountry: "AR",
      remoteOnly: true,
      inboundAddress: `u_${tag}p@ingest.test`,
      profileSummary: "Perfil de prueba.",
    })
    .onConflictDoNothing();
}

async function seedJob(userId: string, status: Status, jdText: string | null) {
  seq += 1;
  const [row] = await conn.db
    .insert(s.jobs)
    .values({
      userId,
      companyRaw: `Empresa ${seq}`,
      title: `Analista ${seq}`,
      titleNormalized: `analista ${seq}`,
      status,
      jdText,
    })
    .returning({ id: s.jobs.id });
  return row!.id;
}

const paste = (userId: string, jobId: string, text: string) =>
  conn.db.transaction((tx) =>
    attachJdText(tx, { userId, jobId, text, taxonomy: [], onlyPending: true }),
  );

const jobOf = async (id: string) =>
  (await conn.db.select().from(s.jobs).where(eq(s.jobs.id, id)))[0]!;
const pastedSources = async (jobId: string) =>
  conn.db
    .select()
    .from(s.jobSources)
    .where(and(eq(s.jobSources.jobId, jobId), eq(s.jobSources.sourceName, "JD pegada")));

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
  conn = createDb(ownerUrl, { max: 12 });
  await seedUser(A, "a51");
  await seedUser(B, "b51");
}, 180_000);

afterAll(async () => {
  await conn?.close();
  await container?.stop();
});

describe("paste_jd solo sobre ofertas pendientes", () => {
  it.each(["pendiente_jd", "prefiltrada"] as const)(
    "una oferta %s sin JD recibe la descripción",
    async (status) => {
      const id = await seedJob(A, status, null);
      await paste(A, id, PASTED("nueva"));
      expect((await jobOf(id)).jdText).toBe(PASTED("nueva").trim());
      expect(await pastedSources(id)).toHaveLength(1);
    },
  );

  it("una oferta pendiente con JD en blanco también la recibe", async () => {
    const id = await seedJob(A, "pendiente_jd", "   ");
    await paste(A, id, PASTED("en-blanco"));
    expect((await jobOf(id)).jdText).toBe(PASTED("en-blanco").trim());
  });

  it("una oferta que ya tiene JD no cambia y no guarda nada", async () => {
    const id = await seedJob(A, "prefiltrada", ORIGINAL);
    await expect(paste(A, id, PASTED("pisa"))).rejects.toBeInstanceOf(JdNotPendingError);
    expect((await jobOf(id)).jdText).toBe(ORIGINAL);
    expect(await pastedSources(id)).toHaveLength(0);
  });

  it.each(["evaluada", "aplicada", "descartada", "cerrada"] as const)(
    "una oferta %s no cambia aunque no tenga JD",
    async (status) => {
      const id = await seedJob(A, status, null);
      await expect(paste(A, id, PASTED("pisa"))).rejects.toBeInstanceOf(JdNotPendingError);
      expect((await jobOf(id)).jdText).toBeNull();
      expect(await pastedSources(id)).toHaveLength(0);
    },
  );

  it("una oferta de otra persona no cambia", async () => {
    const id = await seedJob(B, "pendiente_jd", null);
    await expect(paste(A, id, PASTED("ajena"))).rejects.toBeInstanceOf(JdNotPendingError);
    expect((await jobOf(id)).jdText).toBeNull();
  });

  it("diez pegados en paralelo: uno solo gana y los demás no escriben", async () => {
    const id = await seedJob(A, "pendiente_jd", null);
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) => paste(A, id, PASTED(`par-${i}`))),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      results.filter((r) => r.status === "rejected" && r.reason instanceof JdNotPendingError),
    ).toHaveLength(9);
    const winner = results.findIndex((r) => r.status === "fulfilled");
    expect((await jobOf(id)).jdText).toBe(PASTED(`par-${winner}`).trim());
    expect(await pastedSources(id)).toHaveLength(1);
  });
});
