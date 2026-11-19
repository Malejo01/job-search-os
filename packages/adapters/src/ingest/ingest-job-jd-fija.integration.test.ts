import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { applyMigrations } from "@job-search-os/db/src/migrate";
import { createDb, schema as s } from "@job-search-os/db";
import criteria from "@job-search-os/db/seeds/criteria.example.json";
import { rawJobFromManual } from "@job-search-os/pipeline";
import { eq } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ingestRawJob } from "./ingest-job";

/**
 * La descripción de una oferta que ya se evaluó o se aplicó no cambia al volver a cargar el mismo
 * aviso con un texto más largo (carga manual y fusión). Una oferta que espera su JD sí la recibe.
 */
const USER = "a0000000-0000-4000-8000-000000000002";
let container: StartedPostgreSqlContainer | null = null;
let conn: ReturnType<typeof createDb>;
const logger = pino({ level: "silent" });
const deps = () => ({ db: conn.db, userId: USER, rules: criteria as never, logger });

/** Cada caso usa una empresa y un texto propios, para que el dedup no cruce un caso con otro. */
const textos = (tag: string) => {
  const corta = `Buscamos una persona para una plataforma de ${tag}. TypeScript, Postgres y colas de mensajes. Remoto para Argentina, equipo chico y deploy continuo.`;
  return {
    corta,
    larga: `${corta} TEXTO-NUEVO-MAS-LARGO: Kubernetes, observabilidad, guardias rotativas y compensación por on-call.`,
  };
};

let n = 0;
/** Distinto en cada corrida: si la base es compartida, los avisos de otra corrida no se cruzan. */
const run = Math.random().toString(36).slice(2, 8);
const manual = (url: string, jdText: string | null, company: string) =>
  rawJobFromManual({
    url,
    title: "Backend Engineer (Pagos)",
    company,
    locationRaw: "Remoto (Argentina)",
    modality: "remoto",
    jdText,
  });
const job = async (id: string) =>
  (await conn.db.select().from(s.jobs).where(eq(s.jobs.id, id)))[0]!;

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
      inboundAddress: "u_a0000000_2@ingest.test",
      profileSummary: "AI Engineer.",
    })
    .onConflictDoNothing();
}, 180_000);

afterAll(async () => {
  await conn?.close();
  await container?.stop();
});

describe("la JD de una oferta que ya no espera descripción no cambia", () => {
  it.each(["evaluada", "aplicada"] as const)(
    "una oferta %s no cambia su jd_text ni su hash con una JD más larga",
    async (status) => {
      n += 1;
      const url = `https://empresa-f.example/jobs/${status}-${run}-${n}`;
      const company = `Empresa F ${status}`;
      const { corta, larga } = textos(`pagos ${status}`);
      const first = await ingestRawJob(manual(url, corta, company), deps());
      await conn.db.update(s.jobs).set({ status }).where(eq(s.jobs.id, first.jobId));
      const before = await job(first.jobId);

      const second = await ingestRawJob(manual(url, larga, company), deps());
      expect(second).toMatchObject({ action: "merged", jobId: first.jobId });

      const after = await job(first.jobId);
      expect(after.jdText).toBe(corta);
      expect(after.jdHash).toBe(before.jdHash);
      expect(after.jdText).not.toContain("TEXTO-NUEVO-MAS-LARGO");
      expect(after.status).toBe(status);
    },
  );

  it("una oferta que espera su JD la recibe al volver a cargarla", async () => {
    n += 1;
    const url = `https://empresa-f.example/jobs/pendiente-${run}-${n}`;
    const { larga } = textos("pagos pendiente");
    const first = await ingestRawJob(manual(url, null, "Empresa F pendiente"), deps());
    expect((await job(first.jobId)).status).toBe("pendiente_jd");

    await ingestRawJob(manual(url, larga, "Empresa F pendiente"), deps());
    expect((await job(first.jobId)).jdText).toBe(larga);
  });
});
