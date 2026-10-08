import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { applyMigrations } from "@job-search-os/db/src/migrate";
import { createDb, schema as s } from "@job-search-os/db";
import { formatInboundAddress, tokenFromBytes } from "@job-search-os/pipeline";
import { eq } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pgBlobStorage } from "../storage/blob";
import { handleInboundEmail } from "./handle";
import type { ResendReceivedEvent } from "./resend";

/** JS-095: dirección aleatoria por usuario; la nueva entra al usuario correcto y la vieja ya no. */
const USER_A = "a0000000-0000-4000-8000-0000000000a1";
const USER_B = "b0000000-0000-4000-8000-0000000000b2";
const DOMAIN = "ingest.test";
const bytes = (n: number) => Uint8Array.from({ length: 16 }, (_, i) => (i * 7 + n) % 256);
const ADDR_A1 = formatInboundAddress(tokenFromBytes(bytes(1)), DOMAIN);
const ADDR_A2 = formatInboundAddress(tokenFromBytes(bytes(2)), DOMAIN);
const ADDR_B = formatInboundAddress(tokenFromBytes(bytes(3)), DOMAIN);

let container: StartedPostgreSqlContainer | null = null;
let conn: ReturnType<typeof createDb>;
const logger = pino({ level: "silent" });

const event = (emailId: string, to: string): ResendReceivedEvent => ({
  type: "email.received",
  created_at: "2026-10-08T20:00:00.000Z",
  data: {
    email_id: emailId,
    from: "Equipo de Talento <jobs@example.com>",
    to: [to],
    cc: [],
    bcc: [],
    received_for: [],
    subject: "Aviso de prueba",
    attachments: [],
  },
});

const receive = (emailId: string, to: string) => {
  const ev = event(emailId, to);
  return handleInboundEmail(ev, null, JSON.stringify(ev), {
    db: conn.db,
    storage: pgBlobStorage(conn.db),
    logger,
  });
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
  for (const [userId, inboundAddress] of [
    [USER_A, ADDR_A1],
    [USER_B, ADDR_B],
  ] as const) {
    await conn.db
      .insert(s.profiles)
      .values({
        userId,
        displayName: "Test",
        locationCountry: "AR",
        remoteOnly: true,
        inboundAddress,
        profileSummary: "AI Engineer.",
      })
      .onConflictDoNothing();
  }
}, 180_000);

afterAll(async () => {
  await conn?.close();
  await container?.stop();
});

describe("dirección de email entrante rotada (JS-095)", () => {
  it("un email a la dirección nueva entra al usuario correcto", async () => {
    const out = await receive("em_addr_1", ADDR_A1);
    expect(out).toMatchObject({ kind: "stored", userId: USER_A });
    const outB = await receive("em_addr_b", ADDR_B);
    expect(outB).toMatchObject({ kind: "stored", userId: USER_B });
  });

  it("después de rotar, la vieja da unknown_recipient y la nueva entra", async () => {
    await conn.db
      .update(s.profiles)
      .set({ inboundAddress: ADDR_A2 })
      .where(eq(s.profiles.userId, USER_A));
    expect(await receive("em_addr_2", ADDR_A1)).toMatchObject({ kind: "unknown_recipient" });
    expect(await receive("em_addr_3", ADDR_A2)).toMatchObject({ kind: "stored", userId: USER_A });
  });

  it("el usuario A no puede quedarse con la dirección de B (unique)", async () => {
    await expect(
      conn.db
        .update(s.profiles)
        .set({ inboundAddress: ADDR_B })
        .where(eq(s.profiles.userId, USER_A)),
    ).rejects.toMatchObject({ cause: { code: "23505" } });
    const [a] = await conn.db
      .select({ address: s.profiles.inboundAddress })
      .from(s.profiles)
      .where(eq(s.profiles.userId, USER_A));
    expect(a?.address).toBe(ADDR_A2);
  });
});
