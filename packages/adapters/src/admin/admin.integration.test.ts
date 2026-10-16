import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { createDb, schema as s } from "@job-search-os/db";
import { hashInvitationCode } from "@job-search-os/db/invitation-code";
import { applyMigrations } from "@job-search-os/db/src/migrate";
import { eq, sql } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createInvitationAsAdmin } from "./invite";
import { loadReplayFixture, replayInbound } from "./replay";
import { listTestUsers, resetTestUser } from "./test-users";

/** Comandos admin:* e inbound:replay contra Postgres real (datos 100 % ficticios). */
const ADMIN = { id: "b0000000-0000-4000-8000-000000000001", email: "admin@example.com" };
const PRUEBA = { id: "b0000000-0000-4000-8000-000000000002", email: "prueba@example.com" };
const OTRO = { id: "b0000000-0000-4000-8000-000000000003", email: "otro@example.com" };
const REPLAY = { id: "b0000000-0000-4000-8000-000000000004", email: "replay@example.com" };
const ENV = { ADMIN_EMAILS: "admin@example.com", AUTH_URL: "https://app.example.test/" };
const here = dirname(fileURLToPath(import.meta.url));

let container: StartedPostgreSqlContainer | null = null;
let conn: ReturnType<typeof createDb>;
const logger = pino({ level: "silent" });

async function addUser(u: { id: string; email: string }, inbound: string): Promise<void> {
  await conn.db.insert(s.users).values({ id: u.id, email: u.email }).onConflictDoNothing();
  await conn.db
    .insert(s.profiles)
    .values({
      userId: u.id,
      displayName: "Test",
      locationCountry: "AR",
      inboundAddress: inbound,
    })
    .onConflictDoNothing();
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
  await addUser(ADMIN, "u_adm00001@ingest.test");
  await addUser(PRUEBA, "u_prb00002@ingest.test");
  await addUser(OTRO, "u_otr00003@ingest.test");
  await addUser(REPLAY, "u_rpl00004@ingest.test");
}, 180_000);

afterAll(async () => {
  await conn?.close();
  await container?.stop();
});

describe("admin:invite", () => {
  it("crea la invitación con hash, TTL de 14 días y link", async () => {
    const before = Date.now();
    const res = await createInvitationAsAdmin(
      conn.db,
      { by: "Admin@Example.com", email: "nueva@example.com" },
      ENV,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.link).toBe(`https://app.example.test/register?code=${res.code}`);
    const [row] = await conn.db.select().from(s.invitations).where(eq(s.invitations.id, res.id));
    expect(row).toMatchObject({
      codeHash: hashInvitationCode(res.code),
      email: "nueva@example.com",
      createdByUserId: ADMIN.id,
      usedAt: null,
    });
    const days = (row!.expiresAt.getTime() - before) / 86_400_000;
    expect(days).toBeGreaterThan(13.99);
    expect(days).toBeLessThan(14.01);
  });

  it("rechaza a quien no está en ADMIN_EMAILS y a un --by inexistente", async () => {
    const noAdmin = await createInvitationAsAdmin(conn.db, { by: OTRO.email, email: null }, ENV);
    expect(noAdmin).toEqual({ ok: false, error: "el usuario de --by no está en ADMIN_EMAILS" });
    const missing = await createInvitationAsAdmin(
      conn.db,
      { by: "nadie@example.com", email: null },
      ENV,
    );
    expect(missing.ok).toBe(false);
    const [n] = await conn.db
      .select({ n: sql<number>`count(*)::int` })
      .from(s.invitations)
      .where(eq(s.invitations.createdByUserId, OTRO.id));
    expect(n!.n).toBe(0);
  });
});

describe("admin:test-users", () => {
  it("--list informa existencia, onboarding y conteos", async () => {
    const rows = await listTestUsers(conn.db, [PRUEBA.email, "fantasma@example.com"]);
    expect(rows[0]).toMatchObject({
      email: PRUEBA.email,
      exists: true,
      onboarded: true,
      jobs: 0,
      evaluations: 0,
      applications: 0,
    });
    expect(rows[0]!.createdAt).toBeInstanceOf(Date);
    expect(rows[1]).toMatchObject({ exists: false });
  });

  it("--reset rechaza un email fuera de la allowlist y borra solo el de la allowlist", async () => {
    const allowlist = [PRUEBA.email];
    const rejected = await resetTestUser(conn.db, OTRO.email, allowlist);
    expect(rejected.ok).toBe(false);
    const [stillThere] = await conn.db.select().from(s.users).where(eq(s.users.id, OTRO.id));
    expect(stillThere).toBeDefined();

    const done = await resetTestUser(conn.db, "PRUEBA@example.com", allowlist);
    expect(done.ok).toBe(true);
    const gone = await conn.db.select().from(s.users).where(eq(s.users.id, PRUEBA.id));
    expect(gone).toHaveLength(0);
    const profiles = await conn.db
      .select()
      .from(s.profiles)
      .where(eq(s.profiles.userId, PRUEBA.id));
    expect(profiles).toHaveLength(0);
    // Los demás quedan intactos
    const others = await conn.db.select().from(s.users).where(eq(s.users.id, OTRO.id));
    expect(others).toHaveLength(1);
    const again = await resetTestUser(conn.db, PRUEBA.email, allowlist);
    expect(again.ok).toBe(false);
  });
});

describe("inbound:replay", () => {
  it("el fixture de ejemplo deja una fila en inbound_emails del usuario correcto", async () => {
    const fixture = loadReplayFixture(resolve(here, "fixtures/replay-linkedin-ejemplo.json"), {});
    expect(fixture.ok).toBe(true);
    if (!fixture.ok) return;
    const res = await replayInbound(fixture.loaded, "Replay@Example.com", {
      db: conn.db,
      logger,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const [row] = await conn.db
      .select()
      .from(s.inboundEmails)
      .where(eq(s.inboundEmails.id, res.inboundId));
    expect(row).toMatchObject({ userId: REPLAY.id });
    expect(row!.rawRef).toMatch(/^pg:/);
    expect(res.parser).toBe(row!.parser);
    const others = await conn.db
      .select({ id: s.inboundEmails.id })
      .from(s.inboundEmails)
      .where(eq(s.inboundEmails.userId, OTRO.id));
    expect(others).toHaveLength(0);
  });

  it("un usuario inexistente da error y no escribe nada", async () => {
    const fixture = loadReplayFixture(resolve(here, "fixtures/replay-linkedin-ejemplo.json"), {});
    if (!fixture.ok) throw new Error("fixture de ejemplo ilegible");
    const res = await replayInbound(fixture.loaded, "nadie@example.com", { db: conn.db, logger });
    expect(res.ok).toBe(false);
  });
});
