import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { applyMigrations } from "@job-search-os/db/src/migrate";
import { createDb, schema as s } from "@job-search-os/db";
import criteria from "@job-search-os/db/seeds/criteria.example.json";
import { rawJobFromManual, type RawJob } from "@job-search-os/pipeline";
import { and, eq } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { handleInboundEmail } from "../inbound/handle";
import type { ResendReceivedEvent } from "../inbound/resend";
import page from "../sources/__fixtures__/getonboard-search-page.json";
import { mapGobJob, type GobJobItem, type GobPage } from "../sources/getonboard";
import { pgBlobStorage } from "../storage/blob";
import { attachJdText } from "./attach-jd";
import { ingestRawJob } from "./ingest-job";

/**
 * JS-024 · Toda carga guarda su crudo en raw_blobs antes de procesarse, sea cual sea la vía, y
 * cada job_sources apunta a él. Nació del incidente de ADR-013: una fusión pisó un JD que no
 * estaba guardado en ningún lado.
 */
const USER = "a0000000-0000-4000-8000-000000000001";
let container: StartedPostgreSqlContainer | null = null;
let conn: ReturnType<typeof createDb>;
const logger = pino({ level: "silent" });
const gob = (page as unknown as GobPage).data as GobJobItem[];

const deps = () => ({ db: conn.db, userId: USER, rules: criteria as never, logger });
const storage = () => pgBlobStorage(conn.db);
const jd = (tag: string, extra = "") =>
  `Buscamos ${tag} para una plataforma de pagos. TypeScript, Postgres y colas. Remoto para Argentina. ${extra}`.trim();

async function sourcesOf(jobId: string) {
  return conn.db
    .select()
    .from(s.jobSources)
    .where(eq(s.jobSources.jobId, jobId))
    .orderBy(s.jobSources.seenAt);
}

async function blobCount(kind: string) {
  const rows = await conn.db
    .select({ id: s.rawBlobs.id })
    .from(s.rawBlobs)
    .where(and(eq(s.rawBlobs.userId, USER), eq(s.rawBlobs.kind, kind)));
  return rows.length;
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

describe("JS-024: crudo por vía de ingesta", () => {
  it("manual (UI y MCP add_job): el input tal cual llegó, JD incluido", async () => {
    const input = {
      url: "https://empresa-p.example/jobs/raw-1",
      title: "  Backend Engineer (Pagos) ",
      company: "Empresa P",
      locationRaw: "Remoto (Argentina)",
      modality: "remoto" as const,
      jdText: `  ${jd("Backend Engineer")}  `,
    };
    const out = await ingestRawJob(rawJobFromManual(input), deps());
    expect(out.action).toBe("inserted");
    const [src] = await sourcesOf(out.jobId);
    expect(src?.rawRef).toMatch(/^pg:/);
    const blob = await storage().get(src!.rawRef!);
    expect(blob?.contentType).toBe("application/json");
    expect(JSON.parse(blob!.body)).toEqual(input);
  });

  it("Get on Board: el item de la API; re-ingerir el mismo item no duplica ni blob ni fuente", async () => {
    const item = gob[0]!;
    const first = await ingestRawJob(mapGobJob(item, "programming"), deps());
    const [src] = await sourcesOf(first.jobId);
    expect(JSON.parse((await storage().get(src!.rawRef!))!.body)).toEqual(item);
    const blobs = await blobCount("ingest_getonboard_api");

    // El cron vuelve a traer el mismo aviso cada 6 h
    const again = await ingestRawJob(mapGobJob(item, "programming"), deps());
    expect(again).toMatchObject({ action: "merged", jobId: first.jobId, sourceAdded: false });
    expect(await blobCount("ingest_getonboard_api")).toBe(blobs);
    expect(await sourcesOf(first.jobId)).toHaveLength(1);
  });

  it("Get on Board: si el mismo aviso cambia, la versión nueva se guarda aparte y la vieja sigue accesible", async () => {
    const item = gob[1]!;
    const first = await ingestRawJob(mapGobJob(item, "programming"), deps());
    const edited: GobJobItem = {
      ...item,
      attributes: {
        ...item.attributes,
        description: `${item.attributes.description ?? ""}<p>Actualizado: suman Kubernetes.</p>`,
      },
    };
    const again = await ingestRawJob(mapGobJob(edited, "programming"), deps());
    expect(again).toMatchObject({ action: "merged", jobId: first.jobId, sourceAdded: true });
    const sources = await sourcesOf(first.jobId);
    expect(sources).toHaveLength(2);
    const bodies = await Promise.all(sources.map((x) => storage().get(x.rawRef!)));
    expect(bodies.map((b) => JSON.parse(b!.body))).toEqual([item, edited]);
  });

  it("merge: el JD más corto que la fusión descarta sigue accesible desde su fuente", async () => {
    const url = "https://empresa-p.example/jobs/raw-merge";
    const long = jd(
      "Staff Engineer",
      "Además: liderazgo técnico, mentoría y diseño de APIs públicas.",
    );
    const short = jd("Staff Engineer");
    const a = await ingestRawJob(
      rawJobFromManual({
        url,
        title: "Staff Engineer",
        company: "Empresa P",
        locationRaw: null,
        modality: "remoto",
        jdText: long,
      }),
      deps(),
    );
    const b = await ingestRawJob(
      {
        ...rawJobFromManual({
          url,
          title: "Staff Engineer",
          company: "Empresa P",
          locationRaw: null,
          modality: "remoto",
          jdText: short,
        }),
        source: {
          kind: "email_linkedin",
          name: "alerta",
          externalId: null,
          url,
          rawRef: null,
          original: { contentType: "text/plain", body: short },
        },
      },
      deps(),
    );
    expect(b).toMatchObject({ action: "merged", jobId: a.jobId, reason: "url" });
    const [job] = await conn.db.select().from(s.jobs).where(eq(s.jobs.id, a.jobId));
    expect(job?.jdText).toBe(long);
    const texts = await Promise.all(
      (await sourcesOf(a.jobId)).map(async (x) => (await storage().get(x.rawRef!))!.body),
    );
    expect(texts.some((t) => t.includes("liderazgo técnico"))).toBe(true);
    expect(texts).toContain(short);
  });

  it("fuente vieja sin crudo (anterior a JS-024): la próxima vez que llega se completa, sin agregar fila", async () => {
    const item = gob[2]!;
    const first = await ingestRawJob(mapGobJob(item, "programming"), deps());
    await conn.db
      .update(s.jobSources)
      .set({ rawRef: null })
      .where(eq(s.jobSources.jobId, first.jobId));
    const again = await ingestRawJob(mapGobJob(item, "programming"), deps());
    expect(again).toMatchObject({ action: "merged", sourceAdded: false });
    const sources = await sourcesOf(first.jobId);
    expect(sources).toHaveLength(1);
    expect(JSON.parse((await storage().get(sources[0]!.rawRef!))!.body)).toEqual(item);
  });

  it("fuente sin payload original ni rawRef: se guarda el RawJob tal como entró a la ingesta", async () => {
    const raw: RawJob = {
      ...rawJobFromManual({
        url: "https://empresa-p.example/jobs/raw-fallback",
        title: "Data Engineer",
        company: "Empresa P",
        locationRaw: null,
        modality: "remoto",
        jdText: jd("Data Engineer"),
      }),
    };
    raw.source = { ...raw.source, kind: "other", name: "otra fuente", original: null };
    const out = await ingestRawJob(raw, deps());
    const [src] = await sourcesOf(out.jobId);
    const blob = await storage().get(src!.rawRef!);
    expect(JSON.parse(blob!.body)).toMatchObject({
      title: "Data Engineer",
      jdText: jd("Data Engineer"),
    });
  });

  it("JD pegado en pendientes: el texto pegado queda en raw_blobs y en una fuente propia", async () => {
    const pending = await ingestRawJob(
      rawJobFromManual({
        url: "https://linkedin.com/jobs/view/4400000099",
        title: "Platform Engineer",
        company: "Empresa P",
        locationRaw: "Remoto (Argentina)",
        modality: "remoto",
        jdText: null,
      }),
      deps(),
    );
    expect(pending).toMatchObject({ action: "inserted", status: "pendiente_jd" });
    const pasted = `  ${jd("Platform Engineer", "Terraform y AWS.")}\r\n`;
    await attachJdText(conn.db, { userId: USER, jobId: pending.jobId, text: pasted });

    const [job] = await conn.db.select().from(s.jobs).where(eq(s.jobs.id, pending.jobId));
    expect(job?.jdText).toBe(jd("Platform Engineer", "Terraform y AWS."));
    const sources = await sourcesOf(pending.jobId);
    expect(sources).toHaveLength(2);
    const pastedSource = sources.find((x) => x.sourceName === "JD pegada")!;
    expect(pastedSource.kind).toBe("manual");
    expect((await storage().get(pastedSource.rawRef!))?.body).toBe(pasted);
  });

  it("email de LinkedIn: cada aviso extraído apunta al crudo del email", async () => {
    const html = readFileSync(
      resolve(__dirname, "../inbound/fixtures/linkedin/alerta-dos-avisos.html"),
      "utf8",
    );
    const event: ResendReceivedEvent = {
      type: "email.received",
      created_at: "2026-09-18T11:00:00.000Z",
      data: {
        email_id: "em_raw_1",
        from: "LinkedIn Job Alerts <jobalerts-noreply@linkedin.com>",
        to: ["u_a0000000@ingest.test"],
        cc: [],
        bcc: [],
        received_for: [],
        subject: "Platform: 2 nuevas ofertas",
        attachments: [],
      },
    };
    const out = await handleInboundEmail(
      event,
      { html, text: null, headers: null },
      JSON.stringify(event),
      { db: conn.db, storage: storage(), logger },
    );
    expect(out).toMatchObject({ kind: "stored", parser: "linkedin", jobsExtracted: 2 });
    if (out.kind !== "stored") return;
    const [email] = await conn.db
      .select({ rawRef: s.inboundEmails.rawRef })
      .from(s.inboundEmails)
      .where(eq(s.inboundEmails.id, out.inboundId));
    const fromEmail = await conn.db
      .select({ rawRef: s.jobSources.rawRef })
      .from(s.jobSources)
      .where(eq(s.jobSources.kind, "email_linkedin"));
    const linked = fromEmail.filter((x) => x.rawRef === email!.rawRef);
    expect(linked).toHaveLength(2);
  });
});
