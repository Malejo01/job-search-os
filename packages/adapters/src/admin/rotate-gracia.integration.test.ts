import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { applyMigrations } from "@job-search-os/db/src/migrate";
import { createDb, schema as s } from "@job-search-os/db";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { rotateLegacyInboundAddresses } from "./rotate-inbound";

/** La rotación cuenta las cuentas afectadas y deja la dirección vieja como alias unos días. */
const A = "aa600000-0000-4000-8000-000000000001";
const B = "bb600000-0000-4000-8000-000000000002";
const C = "cc600000-0000-4000-8000-000000000003";
const USERS = [A, B, C];
const NOW = new Date("2026-11-19T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

let container: StartedPostgreSqlContainer | null = null;
let conn: ReturnType<typeof createDb>;

const profileOf = async (userId: string) => {
  const [row] = await conn.db.select().from(s.profiles).where(eq(s.profiles.userId, userId));
  return row!;
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
}, 180_000);

beforeEach(async () => {
  await conn.db.delete(s.inboundEmails).where(inArray(s.inboundEmails.userId, USERS));
  await conn.db.delete(s.profiles).where(inArray(s.profiles.userId, USERS));
  await conn.db.insert(s.profiles).values([
    {
      userId: A,
      displayName: "Persona A",
      locationCountry: "AR",
      inboundAddress: "u_aa600000@ingest.test",
    },
    {
      userId: B,
      displayName: "Persona B",
      locationCountry: "AR",
      inboundAddress: "u_bb600000@ingest.test",
    },
    {
      userId: C,
      displayName: "Persona C",
      locationCountry: "AR",
      inboundAddress: "u_cc600000@ingest.test",
    },
  ]);
  const email = (userId: string, receivedAt: Date, n: number) => ({
    userId,
    emailId: `em_rot_${userId.slice(0, 2)}_${n}`,
    fromAddress: "aviso@example.com",
    rawRef: "pg:00000000-0000-4000-8000-000000000000",
    receivedAt,
  });
  await conn.db.insert(s.inboundEmails).values([email(A, daysAgo(5), 1), email(B, daysAgo(45), 1)]);
});

afterAll(async () => {
  await conn?.db.delete(s.inboundEmails).where(inArray(s.inboundEmails.userId, USERS));
  await conn?.db.delete(s.profiles).where(inArray(s.profiles.userId, USERS));
  await conn?.close();
  await container?.stop();
});

describe("rotación con aviso y gracia", () => {
  it("el modo de conteo informa cuántas cuentas recibieron correo en los últimos 30 días", async () => {
    const before = await profileOf(A);

    const result = await rotateLegacyInboundAddresses(conn.db, { apply: false, now: NOW });

    // A recibió hace 5 días, B hace 45, C nunca
    expect(result.affected).toBe(1);
    expect(result.rotated).toBe(0);
    expect((await profileOf(A)).inboundAddress).toBe(before.inboundAddress);
    expect((await profileOf(A)).previousInboundAddress).toBeNull();
  });

  it("al aplicar, la dirección vieja queda como alias 7 días", async () => {
    const result = await rotateLegacyInboundAddresses(conn.db, { apply: true, now: NOW });

    expect(result.failed).toBe(0);
    const a = await profileOf(A);
    expect(a.previousInboundAddress).toBe("u_aa600000@ingest.test");
    expect(a.inboundAddress).not.toBe("u_aa600000@ingest.test");
    expect(a.previousInboundUntil?.getTime()).toBe(NOW.getTime() + 7 * 86_400_000);
  });

  it("los días de gracia se pueden cambiar", async () => {
    await rotateLegacyInboundAddresses(conn.db, { apply: true, now: NOW, graceDays: 14 });
    expect((await profileOf(B)).previousInboundUntil?.getTime()).toBe(
      NOW.getTime() + 14 * 86_400_000,
    );
  });

  it("el resultado solo trae conteos, nunca direcciones", async () => {
    const result = await rotateLegacyInboundAddresses(conn.db, { apply: true, now: NOW });
    expect(JSON.stringify(result)).not.toContain("@");
    expect(Object.keys(result).sort()).toEqual([
      "affected",
      "failed",
      "legacy",
      "rotated",
      "scanned",
    ]);
  });
});
