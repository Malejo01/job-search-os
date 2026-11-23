import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { applyMigrations } from "@job-search-os/db/src/migrate";
import { createDb, schema as s } from "@job-search-os/db";
import { like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POOL_PARSER } from "../inbound/pool-mailbox";
import { countPoolMailboxExpiring } from "./mailbox-expiry";

/** Emails del pool por vencer: sin dueño, parser del pool, sin leer, de 23 días o más. */
const PREFIX = "mailbox-expiry-test-";
const NOW = new Date("2026-11-22T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const ago = (ms: number) => new Date(NOW.getTime() - ms);

let container: StartedPostgreSqlContainer | null = null;
let conn: ReturnType<typeof createDb>;
let seq = 0;

async function email(over: Partial<typeof s.inboundEmails.$inferInsert>) {
  seq += 1;
  await conn.db.insert(s.inboundEmails).values({
    userId: null,
    fromAddress: "alertas@example.com",
    rawRef: `${PREFIX}${seq}`,
    parser: POOL_PARSER,
    receivedAt: ago(25 * DAY),
    ...over,
  });
}

async function cleanup() {
  await conn.db.delete(s.inboundEmails).where(like(s.inboundEmails.rawRef, `${PREFIX}%`));
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
  await cleanup();
}, 180_000);

afterAll(async () => {
  if (conn) {
    await cleanup();
    await conn.close();
  }
  await container?.stop();
});

describe("countPoolMailboxExpiring", () => {
  it("cuenta solo los del pool sin leer que vencen en los próximos 7 días", async () => {
    const before = await countPoolMailboxExpiring(conn.db, NOW);
    await email({ receivedAt: ago(23 * DAY + 60_000) }); // vence en 7 días: entra
    await email({ receivedAt: ago(29 * DAY) }); // entra
    await email({ receivedAt: ago(31 * DAY) }); // purga atrasada: entra
    await email({ receivedAt: ago(22 * DAY) }); // todavía le quedan más de 7 días: no
    await email({ seenAt: ago(DAY) }); // leído: no
    await email({ dismissedAt: ago(DAY) }); // descartado: no
    await email({ parser: "none" }); // no es del pool: no
    // De una persona: nunca entra
    const [u] = await conn.db
      .insert(s.users)
      .values({ email: `${PREFIX}persona@example.com` })
      .returning({ id: s.users.id });
    await email({ userId: u!.id });
    try {
      expect(await countPoolMailboxExpiring(conn.db, NOW)).toBe(before + 3);
    } finally {
      await conn.db.delete(s.inboundEmails).where(like(s.inboundEmails.rawRef, `${PREFIX}%`));
      await conn.db.delete(s.users).where(like(s.users.email, `${PREFIX}%`));
    }
  });
});
