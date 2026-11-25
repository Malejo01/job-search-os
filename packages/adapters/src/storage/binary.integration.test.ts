import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { applyMigrations } from "@job-search-os/db/src/migrate";
import { createDb, schema as s } from "@job-search-os/db";
import { createHash } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parsePgBinaryRef, pgBinaryStorage } from "./binary";

/**
 * R29-02 · `pgBinaryStorage` por el camino real: el dueño para sembrar y la app como jobsearch_app (con
 * `app.user_id`) para comprobar que una persona no lee ni borra los archivos de otra. Bytes inventados.
 */
const A = "a0000000-0000-4000-8000-000000000291";
const B = "b0000000-0000-4000-8000-000000000291";
const APP_PASSWORD = "jobsearch_app_test";

let container: StartedPostgreSqlContainer | null = null;
let owner: ReturnType<typeof createDb>;
let app: ReturnType<typeof createDb>;

type AppDb = Parameters<Parameters<(typeof app)["db"]["transaction"]>[0]>[0];
async function asUser<T>(userId: string, fn: (tx: AppDb) => Promise<T>): Promise<T> {
  return app.db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
    return fn(tx);
  });
}

// Un contenido con ceros, 0xff y todos los valores de un byte: nada que un texto UTF-8 sobreviva
const BYTES = Uint8Array.from({ length: 600 }, (_, i) => i % 256);

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
  owner = createDb(ownerUrl, { max: 1 });
  await owner.sql.unsafe(`ALTER ROLE jobsearch_app WITH PASSWORD '${APP_PASSWORD}'`);
  const u = new URL(ownerUrl);
  u.username = "jobsearch_app";
  u.password = APP_PASSWORD;
  app = createDb(u.toString(), { max: 2 });
  for (const [id, tag] of [
    [A, "a"],
    [B, "b"],
  ] as const) {
    await owner.db
      .insert(s.users)
      .values({ id, email: `${tag}-291@example.test` })
      .onConflictDoNothing();
  }
}, 180_000);

afterAll(async () => {
  if (owner) {
    await owner.db.delete(s.blobFiles).where(inArray(s.blobFiles.userId, [A, B]));
    await owner.db.delete(s.users).where(inArray(s.users.id, [A, B]));
  }
  await app?.close();
  await owner?.close();
  await container?.stop();
});

describe("parsePgBinaryRef", () => {
  it("solo acepta pgb:<uuid>", () => {
    const id = "3f2b8c1e-9a4d-4e7b-8c21-5d6e7f8a9b0c";
    expect(parsePgBinaryRef(`pgb:${id}`)).toBe(id);
    expect(parsePgBinaryRef(`pgb:${id.toUpperCase()}`)).toBe(id);
    for (const bad of [`pg:${id}`, `blob:${id}`, "pgb:", "pgb:1; drop table x", id, 5, null]) {
      expect(parsePgBinaryRef(bad)).toBeNull();
    }
  });
});

describe("pgBinaryStorage", () => {
  it("guarda y devuelve los mismos bytes, con su tipo, y deja el sha256 y el tamaño", async () => {
    const ref = await asUser(A, (tx) =>
      pgBinaryStorage(tx).put({ userId: A, contentType: "image/webp", bytes: BYTES }),
    );
    expect(ref).toMatch(/^pgb:[0-9a-f-]{36}$/);
    const got = await asUser(A, (tx) => pgBinaryStorage(tx).get(ref));
    expect(got?.contentType).toBe("image/webp");
    expect(Buffer.from(got!.bytes).equals(Buffer.from(BYTES))).toBe(true);
    const [row] = await owner.db
      .select({ bytes: s.blobFiles.bytes, sha256: s.blobFiles.sha256 })
      .from(s.blobFiles)
      .where(eq(s.blobFiles.id, ref.slice(4)));
    expect(row?.bytes).toBe(BYTES.length);
    expect(row?.sha256).toBe(createHash("sha256").update(BYTES).digest("hex"));
  });

  it("una ref inexistente o con otra forma da null", async () => {
    const got = await asUser(A, async (tx) => {
      const st = pgBinaryStorage(tx);
      return [
        await st.get("pgb:00000000-0000-4000-8000-000000000000"),
        await st.get("pg:3f2b8c1e-9a4d-4e7b-8c21-5d6e7f8a9b0c"),
        await st.get("cualquier cosa"),
      ];
    });
    expect(got).toEqual([null, null, null]);
  });

  it("delete borra el archivo y es idempotente", async () => {
    const ref = await asUser(A, (tx) =>
      pgBinaryStorage(tx).put({ userId: A, contentType: "application/pdf", bytes: BYTES }),
    );
    await asUser(A, (tx) => pgBinaryStorage(tx).delete(ref));
    expect(await asUser(A, (tx) => pgBinaryStorage(tx).get(ref))).toBeNull();
    const [n] = await owner.db
      .select({ n: sql<number>`count(*)::int` })
      .from(s.blobFiles)
      .where(eq(s.blobFiles.id, ref.slice(4)));
    expect(n?.n).toBe(0);
    await expect(asUser(A, (tx) => pgBinaryStorage(tx).delete(ref))).resolves.toBeUndefined();
    await expect(
      asUser(A, (tx) => pgBinaryStorage(tx).delete("pgb:basura")),
    ).resolves.toBeUndefined();
  });

  it("una persona no lee ni borra los archivos de otra (RLS), ni los guarda a nombre de otra", async () => {
    const ref = await asUser(A, (tx) =>
      pgBinaryStorage(tx).put({ userId: A, contentType: "image/webp", bytes: BYTES }),
    );
    expect(await asUser(B, (tx) => pgBinaryStorage(tx).get(ref))).toBeNull();
    await asUser(B, (tx) => pgBinaryStorage(tx).delete(ref));
    expect(await asUser(A, (tx) => pgBinaryStorage(tx).get(ref))).not.toBeNull();
    await expect(
      asUser(B, (tx) =>
        pgBinaryStorage(tx).put({ userId: A, contentType: "image/webp", bytes: BYTES }),
      ),
    ).rejects.toThrow();
  });

  it("rechaza un archivo vacío y uno de más de 10 MB (CHECK de la base)", async () => {
    await expect(
      asUser(A, (tx) =>
        pgBinaryStorage(tx).put({ userId: A, contentType: "image/webp", bytes: new Uint8Array(0) }),
      ),
    ).rejects.toThrow(/vacío/);
    await expect(
      asUser(A, (tx) =>
        pgBinaryStorage(tx).put({
          userId: A,
          contentType: "application/pdf",
          bytes: new Uint8Array(10 * 1024 * 1024 + 1),
        }),
      ),
    ).rejects.toThrow();
    // Justo en el tope entra (el error de Drizzle trae los parámetros: 10 MB; se muestra solo la causa)
    const justo = await asUser(A, (tx) =>
      pgBinaryStorage(tx).put({
        userId: A,
        contentType: "application/pdf",
        bytes: new Uint8Array(10 * 1024 * 1024),
      }),
    ).catch((e: { cause?: { message?: string } }) => `ERROR: ${e.cause?.message ?? "sin causa"}`);
    expect(justo).toMatch(/^pgb:/);
  });
});
