import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { applyMigrations } from "@job-search-os/db/src/migrate";
import { createDb, schema as s } from "@job-search-os/db";
import criteria from "@job-search-os/db/seeds/criteria.example.json";
import { eq } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ingestRawJob } from "../ingest/ingest-job";
import page from "../sources/__fixtures__/getonboard-search-page.json";
import { mapGobJob, type GobJobItem, type GobPage } from "../sources/getonboard";
import { pgBlobStorage } from "../storage/blob";
import { handleInboundEmail } from "./handle";
import type { ResendReceivedEvent } from "./resend";

/**
 * JS-022 · El email de Get on Board entra por el mismo webhook que LinkedIn y cruza con el aviso
 * que trae el cron de la API: misma URL canónica (`/jobs/<slug>`), así que no se duplica.
 */
const USER = "a0000000-0000-4000-8000-000000000001";
let container: StartedPostgreSqlContainer | null = null;
let conn: ReturnType<typeof createDb>;
const logger = pino({ level: "silent" });
const gob = (page as unknown as GobPage).data as GobJobItem[];

const SELECCION = readFileSync(
  resolve(__dirname, "fixtures/getonboard/seleccion-dos-empleos.html"),
  "utf8",
);

/** Un item de la API cuyo slug es el de un aviso del email. */
const itemCon = (base: GobJobItem, slug: string): GobJobItem => ({
  ...base,
  id: slug,
  links: { public_url: `https://www.getonbrd.com/jobs/${slug}` },
});

const event = (emailId: string): ResendReceivedEvent => ({
  type: "email.received",
  created_at: "2026-09-20T02:12:42.000Z",
  data: {
    email_id: emailId,
    from: "Get on Board <no-reply@getonbrd.com>",
    to: ["u_a0000000@ingest.test"],
    cc: [],
    bcc: [],
    received_for: [],
    subject: "Revisa nuestra selección de empleos increíbles para ti",
    attachments: [],
  },
});

const recibir = (emailId: string) =>
  handleInboundEmail(
    event(emailId),
    { html: SELECCION, text: null, headers: null },
    JSON.stringify(event(emailId)),
    { db: conn.db, storage: pgBlobStorage(conn.db), logger },
  );

const jobPorUrl = async (slug: string) => {
  const [job] = await conn.db
    .select()
    .from(s.jobs)
    .where(eq(s.jobs.canonicalUrl, `https://getonbrd.com/jobs/${slug}`));
  return job;
};

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
  await conn.db
    .insert(s.evaluationCriteria)
    .values({ userId: USER, version: 1, active: true, rules: criteria as never })
    .onConflictDoNothing();
}, 180_000);

afterAll(async () => {
  await conn?.close();
  await container?.stop();
});

describe("JS-022: email de Get on Board por el webhook", () => {
  it("el aviso que ya trajo el cron se fusiona (conserva su JD); el otro entra pendiente de JD", async () => {
    const deps = { db: conn.db, userId: USER, rules: criteria as never, logger };
    const api = await ingestRawJob(
      mapGobJob(itemCon(gob[0]!, "desarrollador-backend-empresa-norte-remote"), "programming"),
      deps,
    );
    const jdApi = (await jobPorUrl("desarrollador-backend-empresa-norte-remote"))!.jdText;
    expect(jdApi).toBeTruthy();

    const out = await recibir("em_gob_1");
    expect(out).toMatchObject({
      kind: "stored",
      parser: "getonboard",
      jobsExtracted: 2,
      error: null,
    });

    const norte = await jobPorUrl("desarrollador-backend-empresa-norte-remote");
    expect(norte!.id).toBe(api.jobId);
    expect(norte!.jdText).toBe(jdApi);
    const fuentes = await conn.db
      .select({ kind: s.jobSources.kind, rawRef: s.jobSources.rawRef })
      .from(s.jobSources)
      .where(eq(s.jobSources.jobId, api.jobId));
    expect(fuentes.map((f) => f.kind).sort()).toEqual(["email_getonboard", "getonboard_api"]);

    const sur = await jobPorUrl("lider-de-plataforma-empresa-sur-remote");
    expect(sur).toMatchObject({ status: "pendiente_jd", jdText: null });

    // cada aviso apunta al crudo del email (JS-024)
    if (out.kind !== "stored") return;
    const [email] = await conn.db
      .select({ rawRef: s.inboundEmails.rawRef })
      .from(s.inboundEmails)
      .where(eq(s.inboundEmails.id, out.inboundId));
    expect(fuentes.find((f) => f.kind === "email_getonboard")?.rawRef).toBe(email!.rawRef);
  });

  it("si el email llega primero, el cron después completa el JD del mismo aviso", async () => {
    const sur = await jobPorUrl("lider-de-plataforma-empresa-sur-remote");
    const deps = { db: conn.db, userId: USER, rules: criteria as never, logger };
    const api = await ingestRawJob(
      mapGobJob(itemCon(gob[1]!, "lider-de-plataforma-empresa-sur-remote"), "programming"),
      deps,
    );
    expect(api).toMatchObject({ action: "merged", jobId: sur!.id });
    expect((await jobPorUrl("lider-de-plataforma-empresa-sur-remote"))!.jdText).toBeTruthy();
  });
});
