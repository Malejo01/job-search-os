import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { applyMigrations } from "@job-search-os/db/src/migrate";
import { createDb, schema as s } from "@job-search-os/db";
import { isInboundToken, isLegacyInboundAddress } from "@job-search-os/pipeline";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { rotateLegacyInboundAddresses } from "./rotate-inbound";

/** Rotación de direcciones de ingesta derivadas del id. Cuentas y direcciones inventadas. */
const LEGACY_A = "aa300000-0000-4000-8000-000000000001";
const LEGACY_B = "bb300000-0000-4000-8000-000000000002";
const RANDOM = "cc300000-0000-4000-8000-000000000003";
const USERS = [LEGACY_A, LEGACY_B, RANDOM];
const RANDOM_ADDRESS = "u_abcdefghijklmnopqrst@ingest.test";

let container: StartedPostgreSqlContainer | null = null;
let conn: ReturnType<typeof createDb>;

async function addresses(): Promise<Map<string, string>> {
  const rows = await conn.db
    .select({ userId: s.profiles.userId, address: s.profiles.inboundAddress })
    .from(s.profiles)
    .where(inArray(s.profiles.userId, USERS));
  return new Map(rows.map((r) => [r.userId, r.address]));
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

beforeEach(async () => {
  await conn.db.delete(s.profiles).where(inArray(s.profiles.userId, USERS));
  await conn.db.insert(s.profiles).values([
    {
      userId: LEGACY_A,
      displayName: "Persona A",
      locationCountry: "AR",
      inboundAddress: "u_aa300000@ingest.test",
    },
    {
      userId: LEGACY_B,
      displayName: "Persona B",
      locationCountry: "AR",
      inboundAddress: "u_bb300000@otro-dominio.test",
    },
    {
      userId: RANDOM,
      displayName: "Persona C",
      locationCountry: "AR",
      inboundAddress: RANDOM_ADDRESS,
    },
  ]);
});

afterAll(async () => {
  await conn?.db.delete(s.profiles).where(inArray(s.profiles.userId, USERS));
  await conn?.close();
  await container?.stop();
});

describe("rotateLegacyInboundAddresses", () => {
  it("sin aplicar solo cuenta y no cambia ninguna dirección", async () => {
    const before = await addresses();
    const result = await rotateLegacyInboundAddresses(conn.db, { apply: false });
    expect(result.legacy).toBeGreaterThanOrEqual(2);
    expect(result.rotated).toBe(0);
    expect(await addresses()).toEqual(before);
  });

  it("al aplicar no queda ninguna dirección derivada del id", async () => {
    const result = await rotateLegacyInboundAddresses(conn.db, { apply: true });
    expect(result.failed).toBe(0);
    expect(result.rotated).toBe(result.legacy);

    const rows = await conn.db
      .select({ userId: s.profiles.userId, address: s.profiles.inboundAddress })
      .from(s.profiles);
    expect(rows.filter((r) => isLegacyInboundAddress(r.address, r.userId))).toEqual([]);
  });

  it("la dirección nueva es aleatoria y conserva el dominio", async () => {
    await rotateLegacyInboundAddresses(conn.db, { apply: true });
    const after = await addresses();
    const [localA, domainA] = after.get(LEGACY_A)!.split("@");
    expect(isInboundToken(localA!.replace(/^u_/, ""))).toBe(true);
    expect(domainA).toBe("ingest.test");
    expect(after.get(LEGACY_B)!.endsWith("@otro-dominio.test")).toBe(true);
    expect(after.get(LEGACY_A)).not.toBe(after.get(LEGACY_B));
  });

  it("no toca las direcciones que ya son aleatorias", async () => {
    await rotateLegacyInboundAddresses(conn.db, { apply: true });
    const [row] = await conn.db
      .select({ address: s.profiles.inboundAddress })
      .from(s.profiles)
      .where(eq(s.profiles.userId, RANDOM));
    expect(row!.address).toBe(RANDOM_ADDRESS);
  });

  it("aplicar dos veces no vuelve a rotar", async () => {
    await rotateLegacyInboundAddresses(conn.db, { apply: true });
    const first = await addresses();
    const again = await rotateLegacyInboundAddresses(conn.db, { apply: true });
    expect(again.rotated).toBe(0);
    expect(await addresses()).toEqual(first);
  });

  it("el resultado solo trae conteos, nunca direcciones", async () => {
    const result = await rotateLegacyInboundAddresses(conn.db, { apply: true });
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
