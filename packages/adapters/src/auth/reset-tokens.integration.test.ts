import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { applyMigrations } from "@job-search-os/db/src/migrate";
import { createDb, schema as s } from "@job-search-os/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { markAllResetTokensUsed } from "./reset-tokens";

/** SEC-05 · al consumir un token, todos los del usuario quedan usados; los de otros no. */
const USER = "a0000000-0000-4000-8000-000000000068";
const OTHER = "b0000000-0000-4000-8000-000000000068";
let container: StartedPostgreSqlContainer | null = null;
let conn: ReturnType<typeof createDb>;

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
    .insert(s.users)
    .values([
      { id: USER, email: "a068@usuario.test", passwordHash: "x" },
      { id: OTHER, email: "b068@usuario.test", passwordHash: "x" },
    ])
    .onConflictDoNothing();
}, 180_000);

afterAll(async () => {
  await conn?.close();
  await container?.stop();
});

describe("markAllResetTokensUsed", () => {
  it("marca usados los dos tokens del usuario y no toca los de otro", async () => {
    const expiresAt = new Date(Date.now() + 3_600_000);
    await conn.db.insert(s.passwordResetTokens).values([
      { userId: USER, tokenHash: "hash-068-a", expiresAt },
      { userId: USER, tokenHash: "hash-068-b", expiresAt },
      { userId: OTHER, tokenHash: "hash-068-c", expiresAt },
    ]);

    await conn.db.transaction((tx) => markAllResetTokensUsed(tx, USER, new Date()));

    const rows = await conn.db.select().from(s.passwordResetTokens);
    const mine = rows.filter((r) => r.userId === USER);
    expect(mine).toHaveLength(2);
    expect(mine.every((r) => r.usedAt !== null)).toBe(true);
    const other = await conn.db
      .select()
      .from(s.passwordResetTokens)
      .where(eq(s.passwordResetTokens.userId, OTHER));
    expect(other[0]!.usedAt).toBeNull();
  });
});
