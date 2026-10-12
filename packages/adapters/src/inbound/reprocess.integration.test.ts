import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { applyMigrations } from "@job-search-os/db/src/migrate";
import { createDb, schema as s } from "@job-search-os/db";
import criteria from "@job-search-os/db/seeds/criteria.example.json";
import { eq } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pgBlobStorage } from "../storage/blob";
import { MANUAL_QUEUE_REASON, UNEXPECTED_SENDER_REASON } from "./handle";
import { reprocessManualQueue } from "./reprocess";

/**
 * Reprocesar la cola manual: emails de Eightfold que quedaron con `parser = 'none'` antes de que
 * existiera el parser. Datos sintéticos. Las filas se arman como las dejaba el webhook.
 */
const USER = "a0000000-0000-4000-8000-000000000001";
const USER2 = "b0000000-0000-4000-8000-000000000002";
let container: StartedPostgreSqlContainer | null = null;
let conn: ReturnType<typeof createDb>;
const logger = pino({ level: "silent" });

const HTML = readFileSync(resolve(__dirname, "fixtures/eightfold-match.html"), "utf8");
const SIN_PID = readFileSync(resolve(__dirname, "fixtures/eightfold-sin-pid.html"), "utf8");
const EIGHTFOLD = '"Eightfold" <notifications@mail.eightfold.ai>';
const OTRO = "Otra Fuente <avisos@otra-fuente.example>";

/** Una fila de la cola manual con su crudo, como la dejaba el webhook sin parser. */
async function encolar(input: {
  from: string;
  html: string | null;
  error?: string;
  parser?: string;
  dismissed?: boolean;
  userId?: string;
}): Promise<string> {
  const userId = input.userId ?? USER;
  const rawRef = await pgBlobStorage(conn.db).put({
    userId,
    kind: "inbound_email",
    contentType: "application/json",
    body: JSON.stringify(
      input.html
        ? { event: { data: { from: input.from } }, content: { html: input.html, text: null } }
        : {
            event: { data: { from: input.from } },
            content: null,
            redacted: UNEXPECTED_SENDER_REASON,
          },
    ),
  });
  const [row] = await conn.db
    .insert(s.inboundEmails)
    .values({
      userId,
      fromAddress: input.from,
      subject: "This job is a match",
      rawRef,
      parser: input.parser ?? "none",
      jobsExtracted: 0,
      error: input.error ?? MANUAL_QUEUE_REASON,
      receivedAt: new Date("2026-10-08T12:00:00Z"),
      dismissedAt: input.dismissed ? new Date("2026-10-08T13:00:00Z") : null,
    })
    .returning({ id: s.inboundEmails.id });
  return row!.id;
}

const fila = async (id: string) =>
  (await conn.db.select().from(s.inboundEmails).where(eq(s.inboundEmails.id, id)))[0]!;

const ofertasEightfold = async () =>
  conn.db.select().from(s.jobSources).where(eq(s.jobSources.sourceName, "Eightfold (email)"));

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
  await conn.db
    .insert(s.profiles)
    .values({
      userId: USER2,
      displayName: "Test 2",
      locationCountry: "AR",
      remoteOnly: true,
      inboundAddress: "u_b0000000@ingest.test",
      profileSummary: "Data Analyst.",
    })
    .onConflictDoNothing();
  await conn.db
    .insert(s.evaluationCriteria)
    .values({ userId: USER2, version: 1, active: true, rules: criteria as never })
    .onConflictDoNothing();
}, 180_000);

afterAll(async () => {
  await conn?.close();
  await container?.stop();
});

describe("reprocessManualQueue", () => {
  it("un email de Eightfold en cola manual pasa a parseado con su oferta; el resto no se toca", async () => {
    const eightfold = await encolar({ from: EIGHTFOLD, html: HTML });
    const roto = await encolar({ from: EIGHTFOLD, html: SIN_PID });
    const sinCuerpo = await encolar({
      from: EIGHTFOLD,
      html: null,
      error: UNEXPECTED_SENDER_REASON,
    });
    const descartado = await encolar({ from: EIGHTFOLD, html: HTML, dismissed: true });
    const otro = await encolar({ from: OTRO, html: HTML });
    const yaParseado = await encolar({
      from: EIGHTFOLD,
      html: HTML,
      parser: "eightfold",
      error: "otro error",
    });
    // Falló antes con este mismo parser: se vuelve a intentar
    const reintento = await encolar({
      from: EIGHTFOLD,
      html: HTML,
      parser: "eightfold",
      error: "estructura no reconocida (eightfold): sin pid. Cola manual",
    });
    const antes = {
      roto: await fila(roto),
      sinCuerpo: await fila(sinCuerpo),
      descartado: await fila(descartado),
      otro: await fila(otro),
      yaParseado: await fila(yaParseado),
    };

    // Dry-run: cuenta, no escribe
    const seco = await reprocessManualQueue(conn.db, {
      parser: "eightfold",
      userId: USER,
      dryRun: true,
      logger,
    });
    expect(seco).toMatchObject({ dryRun: true, candidates: 4, parsed: 2, jobs: 2 });
    expect(await ofertasEightfold()).toHaveLength(0);
    expect((await fila(eightfold)).parser).toBe("none");

    const res = await reprocessManualQueue(conn.db, {
      parser: "eightfold",
      userId: USER,
      logger,
    });
    expect(res).toEqual({
      parser: "eightfold",
      dryRun: false,
      candidates: 4,
      parsed: 2,
      jobs: 2,
      stillFailing: 1,
      withoutBody: 1,
      ingestFailed: 0,
    });

    const despues = await fila(eightfold);
    expect(despues).toMatchObject({ parser: "eightfold", jobsExtracted: 1, error: null });
    expect(despues.seenAt).not.toBeNull();
    const ofertas = await ofertasEightfold();
    expect(new Set(ofertas.map((o) => o.jobId)).size).toBe(1);
    expect(ofertas[0]).toMatchObject({ externalId: "eightfold:empresa-ficticia:900100200300" });
    expect(await fila(reintento)).toMatchObject({
      parser: "eightfold",
      jobsExtracted: 1,
      error: null,
    });

    // Lo demás queda exactamente como estaba
    expect(await fila(roto)).toEqual(antes.roto);
    expect(await fila(sinCuerpo)).toEqual(antes.sinCuerpo);
    expect(await fila(descartado)).toEqual(antes.descartado);
    expect(await fila(otro)).toEqual(antes.otro);
    expect(await fila(yaParseado)).toEqual(antes.yaParseado);
  });

  it("correrlo dos veces no duplica las ofertas", async () => {
    const otraVez = await reprocessManualQueue(conn.db, {
      parser: "eightfold",
      userId: USER,
      logger,
    });
    expect(otraVez).toMatchObject({ candidates: 2, parsed: 0, jobs: 0 });
    expect(new Set((await ofertasEightfold()).map((o) => o.jobId)).size).toBe(1);
  });

  it("un email con el mismo pid que una oferta ya cargada no la duplica", async () => {
    const repetido = await encolar({ from: EIGHTFOLD, html: HTML.replace("trk=abc123", "trk=x") });
    const res = await reprocessManualQueue(conn.db, { parser: "eightfold", userId: USER, logger });
    expect(res.parsed).toBe(1);
    expect((await fila(repetido)).parser).toBe("eightfold");
    const jobIds = new Set((await ofertasEightfold()).map((r) => r.jobId));
    expect(jobIds.size).toBe(1);
  });

  it("con userId solo toca las filas de esa persona y las ofertas no se cruzan", async () => {
    const deUno = await encolar({
      from: EIGHTFOLD,
      html: HTML.replace("900100200300", "900100200777"),
    });
    const deDos = await encolar({
      from: EIGHTFOLD,
      html: HTML.replace("900100200300", "900100200888"),
      userId: USER2,
    });

    const res = await reprocessManualQueue(conn.db, { parser: "eightfold", userId: USER2, logger });
    expect(res).toMatchObject({ candidates: 1, parsed: 1, jobs: 1 });
    expect((await fila(deUno)).parser).toBe("none");
    expect((await fila(deDos)).parser).toBe("eightfold");

    const delUno = await conn.db.select().from(s.jobs).where(eq(s.jobs.userId, USER));
    const delDos = await conn.db.select().from(s.jobs).where(eq(s.jobs.userId, USER2));
    expect(delDos).toHaveLength(1);
    expect(delUno.some((j) => j.id === delDos[0]!.id)).toBe(false);
    const fuentes = await conn.db
      .select()
      .from(s.jobSources)
      .where(eq(s.jobSources.externalId, "eightfold:empresa-ficticia:900100200777"));
    expect(fuentes).toHaveLength(0);
  });

  it("un parser sin registrar es un error, no una corrida vacía", async () => {
    await expect(
      reprocessManualQueue(conn.db, { parser: "generic", userId: USER, logger }),
    ).rejects.toThrow(/no hay parser/);
  });
});
