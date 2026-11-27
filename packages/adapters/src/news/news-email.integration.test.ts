import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { createDb, schema as s } from "@job-search-os/db";
import { applyMigrations } from "@job-search-os/db/src/migrate";
import { eq, inArray, like } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createDbNewsStore, runNewsEmail } from "./news-email";

/**
 * Email de novedades (R32-09) contra Postgres real, con el store real y el envío simulado: datos 100 % ficticios.
 * Nada sale a ningún servicio: `send` es un `vi.fn`.
 */
const DAY = 86_400_000;
const NOW = new Date("2026-12-14T13:00:00.000Z");
const days = (n: number) => new Date(NOW.getTime() + n * DAY);
const ID = (n: number) => `e3200000-0000-4000-8000-00000000090${n}`;
const IDS = [1, 2, 3, 4, 5, 6].map(ID);
const ENV = {
  NEWS_EMAIL: "all",
  RESEND_API_KEY: "re_test",
  EMAIL_FROM: "Novedades <novedades@example.test>",
  AUTH_URL: "https://app.example.test",
  AUTH_SECRET: "secreto-de-prueba-largo-0123456789",
};
const LABELS = {
  careerLabel: (role: string) => (role === "abogacia" ? "Abogacía" : null),
  sealWords: {
    alta: "Afinidad alta",
    media: "Afinidad media",
    baja: "Afinidad baja",
    sin_evaluar: "Sin evaluar",
  },
  aclaracion: "Aclaración fija de prueba.",
};

let container: StartedPostgreSqlContainer | null = null;
let conn: ReturnType<typeof createDb>;
const logger = pino({ level: "silent" });

async function addPerson(
  n: number,
  over: {
    roles?: string[];
    newsEmail?: boolean;
    sentAt?: Date | null;
    isTest?: boolean;
    blocked?: boolean;
  } = {},
): Promise<void> {
  await conn.db.insert(s.users).values({
    id: ID(n),
    email: `news-${n}@ejemplo.test`,
    isTest: over.isTest ?? false,
    blockedAt: over.blocked ? NOW : null,
  });
  await conn.db.insert(s.profiles).values({
    userId: ID(n),
    displayName: `Persona ${n} Apellido`,
    locationCountry: "AR",
    inboundAddress: `u_news0${n}@ingest.test`,
    targetRoles: over.roles ?? ["abogacia"],
    newsEmail: over.newsEmail ?? true,
    newsEmailSentAt: over.sentAt ?? null,
  });
}

async function addJob(
  n: number,
  title: string,
  over: {
    firstSeenAt?: Date;
    status?: "nueva" | "prefiltrada" | "evaluada" | "descartada";
    pool?: boolean;
    score?: number | null;
  } = {},
): Promise<string> {
  let publicJobId: string | null = null;
  if (over.pool ?? true) {
    const [pub] = await conn.db
      .insert(s.publicJobs)
      .values({
        sourceKind: "remoteok",
        externalId: `news-int-${n}-${title}`,
        sourceName: "Remote OK",
        sourceUrl: `https://example.com/news/${n}/${encodeURIComponent(title)}`,
        title,
        titleNormalized: title.toLowerCase(),
        companyRaw: "Empresa A",
        companyNormalized: "empresa a",
        jdHash: `news-int-${n}-${title}`,
        firstSeenAt: NOW,
        lastSeenAt: NOW,
      })
      .returning({ id: s.publicJobs.id });
    publicJobId = pub!.id;
  }
  const [job] = await conn.db
    .insert(s.jobs)
    .values({
      userId: ID(n),
      companyRaw: "Empresa A",
      title,
      titleNormalized: title.toLowerCase(),
      status: over.status ?? "prefiltrada",
      flags: [],
      publicJobId,
      firstSeenAt: over.firstSeenAt ?? days(-1),
    })
    .returning({ id: s.jobs.id });
  if (over.score !== undefined && over.score !== null) {
    await conn.db.insert(s.evaluations).values({
      jobId: job!.id,
      userId: ID(n),
      criteriaVersion: 1,
      promptVersion: "evaluate_job@v1.5.0",
      model: "m",
      hadFullJd: true,
      score: over.score,
      locationOk: "ok",
      modality: "remoto",
      discipline: "abogacia",
      matchFuerte: [],
      gaps: [],
      bloqueadoresDuros: [],
      senalesPositivas: [],
      veredicto: "ok",
      accion: "aplicar",
    } as never);
  }
  return job!.id;
}

async function sentAt(n: number): Promise<Date | null> {
  const [row] = await conn.db
    .select({ at: s.profiles.newsEmailSentAt })
    .from(s.profiles)
    .where(eq(s.profiles.userId, ID(n)));
  return row?.at ?? null;
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
}, 180_000);

afterAll(async () => {
  if (conn) {
    await conn.db.delete(s.jobs).where(inArray(s.jobs.userId, IDS));
    await conn.db.delete(s.profiles).where(inArray(s.profiles.userId, IDS));
    await conn.db.delete(s.users).where(inArray(s.users.id, IDS));
    await conn.db.delete(s.publicJobs).where(like(s.publicJobs.externalId, "news-int-%"));
  }
  await conn?.close();
  await container?.stop();
});

describe("email de novedades con el store real (R32-09)", () => {
  beforeEach(async () => {
    await conn.db.delete(s.jobs).where(inArray(s.jobs.userId, IDS));
    await conn.db.delete(s.profiles).where(inArray(s.profiles.userId, IDS));
    await conn.db.delete(s.users).where(inArray(s.users.id, IDS));
    await conn.db.delete(s.publicJobs).where(like(s.publicJobs.externalId, "news-int-%"));
  });

  it("manda a quien tiene ofertas nuevas del pool, ordenadas por afinidad, y marca el envío", async () => {
    await addPerson(1);
    await addJob(1, "Oferta ficticia baja", { score: 3 });
    await addJob(1, "Oferta ficticia alta", { score: 8.4, status: "evaluada" });
    await addJob(1, "Oferta ficticia sin evaluar");
    const send = vi.fn().mockResolvedValue(undefined);
    const out = await runNewsEmail({
      store: createDbNewsStore(conn.db),
      env: ENV,
      now: NOW,
      logger,
      send,
      labels: LABELS,
    });
    expect(out).toMatchObject({ ok: true, due: 1, sent: 1, failed: 0 });
    const text: string = send.mock.calls[0]![0].text;
    // Primero la de mayor puntaje; la sin evaluar, al final
    expect(text.indexOf("Oferta ficticia alta")).toBeGreaterThan(-1);
    expect(text.indexOf("Oferta ficticia alta")).toBeLessThan(text.indexOf("Oferta ficticia baja"));
    expect(text.indexOf("Oferta ficticia baja")).toBeLessThan(
      text.indexOf("Oferta ficticia sin evaluar"),
    );
    expect(text).toContain("Afinidad alta, 8,4 de 10");
    expect(text).toContain("Hola Persona:");
    expect((await sentAt(1))?.getTime()).toBe(NOW.getTime());
  });

  it("no cuenta lo cargado a mano, lo descartado ni lo viejo, y sin ofertas nuevas no manda ni marca", async () => {
    await addPerson(2);
    await addJob(2, "Cargada a mano", { pool: false });
    await addJob(2, "Descartada", { status: "descartada" });
    await addJob(2, "Vieja", { firstSeenAt: days(-30) });
    const send = vi.fn().mockResolvedValue(undefined);
    const out = await runNewsEmail({
      store: createDbNewsStore(conn.db),
      env: ENV,
      now: NOW,
      logger,
      send,
      labels: LABELS,
    });
    expect(out.sent).toBe(0);
    expect(out.skippedBy).toMatchObject({ sin_novedades: 1 });
    expect(send).not.toHaveBeenCalled();
    expect(await sentAt(2)).toBeNull();
  });

  it("no manda a quien se dio de baja, a las cuentas de prueba, a las bloqueadas ni a quien no tiene carrera", async () => {
    await addPerson(3, { newsEmail: false });
    await addPerson(4, { isTest: true });
    await addPerson(5, { blocked: true });
    await addPerson(6, { roles: [] });
    for (const n of [3, 4, 5, 6]) await addJob(n, `Oferta ficticia ${n}`, { score: 7 });
    const send = vi.fn().mockResolvedValue(undefined);
    const out = await runNewsEmail({
      store: createDbNewsStore(conn.db),
      env: ENV,
      now: NOW,
      logger,
      send,
      labels: LABELS,
    });
    expect(out).toMatchObject({ sent: 0, due: 0 });
    expect(send).not.toHaveBeenCalled();
  });

  it("como mucho semanal: un segundo corrida inmediata no repite, y recién a los 7 días vuelve a mandar solo lo nuevo", async () => {
    await addPerson(1);
    await addJob(1, "Primera oferta", { firstSeenAt: days(-2) });
    const store = createDbNewsStore(conn.db);
    const send = vi.fn().mockResolvedValue(undefined);
    const first = await runNewsEmail({ store, env: ENV, now: NOW, logger, send, labels: LABELS });
    expect(first.sent).toBe(1);

    // La misma semana, aunque haya una oferta nueva: no manda
    await addJob(1, "Segunda oferta", { firstSeenAt: days(1) });
    const again = await runNewsEmail({
      store,
      env: ENV,
      now: days(2),
      logger,
      send,
      labels: LABELS,
    });
    expect(again.sent).toBe(0);
    expect(again.skippedBy).toMatchObject({ reciente: 1 });

    // A los 7 días: manda, pero solo lo que llegó después del envío anterior
    const next = await runNewsEmail({
      store,
      env: ENV,
      now: days(7),
      logger,
      send,
      labels: LABELS,
    });
    expect(next.sent).toBe(1);
    const text: string = send.mock.calls[1]![0].text;
    expect(text).toContain("Segunda oferta");
    expect(text).not.toContain("Primera oferta");
  });

  it("dos corridas a la vez no mandan dos emails a la misma persona", async () => {
    await addPerson(1);
    await addJob(1, "Oferta ficticia");
    const send = vi.fn().mockResolvedValue(undefined);
    const runs = await Promise.all([
      runNewsEmail({
        store: createDbNewsStore(conn.db),
        env: ENV,
        now: NOW,
        logger,
        send,
        labels: LABELS,
      }),
      runNewsEmail({
        store: createDbNewsStore(conn.db),
        env: ENV,
        now: NOW,
        logger,
        send,
        labels: LABELS,
      }),
    ]);
    expect(runs.reduce((n, r) => n + r.sent, 0)).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("si el envío falla, devuelve la marca para que la próxima corrida reintente", async () => {
    await addPerson(1);
    await addJob(1, "Oferta ficticia");
    const send = vi.fn().mockRejectedValue(new Error("Resend POST /emails: HTTP 500"));
    const out = await runNewsEmail({
      store: createDbNewsStore(conn.db),
      env: ENV,
      now: NOW,
      logger,
      send,
      labels: LABELS,
    });
    expect(out).toMatchObject({ sent: 0, failed: 1 });
    expect(await sentAt(1)).toBeNull();
  });

  it("apagada (sin NEWS_EMAIL) no lee ni marca nada", async () => {
    await addPerson(1);
    await addJob(1, "Oferta ficticia");
    const send = vi.fn();
    const out = await runNewsEmail({
      store: createDbNewsStore(conn.db),
      env: { ...ENV, NEWS_EMAIL: undefined },
      now: NOW,
      logger,
      send,
      labels: LABELS,
    });
    expect(out).toMatchObject({ skipped: "apagado", sent: 0 });
    expect(send).not.toHaveBeenCalled();
    expect(await sentAt(1)).toBeNull();
  });
});
