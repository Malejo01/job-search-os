import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { applyMigrations } from "@job-search-os/db/src/migrate";
import { createDb, isRemoteDatabase, schema as s } from "@job-search-os/db";
import { inferRoleHints } from "@job-search-os/pipeline";
import { eq, like, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rehintPool } from "./rehint";

/**
 * Ronda 102 · `rehintPool`. Avisos inventados (Empresa Ficticia N), conexión dueña como el servicio.
 */
const PREFIX = "rehint-test-";
const NOW = new Date("2026-10-20T12:00:00Z");
const FRESH = new Date("2026-10-18T12:00:00Z");
const STALE = new Date("2026-08-01T12:00:00Z");
const UPDATED = new Date("2026-10-10T08:00:00Z");

const JD_ES =
  "Buscamos una persona para sumarse a nuestro equipo de producto. Vas a trabajar con el área de diseño y " +
  "con las personas que usan la plataforma todos los días, para entender qué necesitan y ordenar el trabajo " +
  "de cada semana con foco en los resultados del negocio.";

let container: StartedPostgreSqlContainer | null = null;
let conn: ReturnType<typeof createDb>;

type Seed = {
  id: string;
  title: string;
  roleHints: string[];
  lang?: string | null;
  jdText?: string | null;
  lastSeenAt?: Date;
  dedupOfId?: string | null;
};

async function seed(x: Seed): Promise<string> {
  const [r] = await conn.db
    .insert(s.publicJobs)
    .values({
      sourceKind: "remoteok",
      externalId: `${PREFIX}${x.id}`,
      sourceName: "Remote OK",
      sourceUrl: `https://example.com/jobs/${PREFIX}${x.id}`,
      title: x.title,
      titleNormalized: x.title.toLowerCase(),
      companyRaw: "Empresa Ficticia 1",
      companyNormalized: "empresa ficticia 1",
      roleHints: x.roleHints,
      lang: x.lang ?? null,
      jdText: x.jdText ?? null,
      tags: [],
      categories: [],
      firstSeenAt: x.lastSeenAt ?? FRESH,
      lastSeenAt: x.lastSeenAt ?? FRESH,
      dedupOfId: x.dedupOfId ?? null,
      updatedAt: UPDATED,
    })
    .returning({ id: s.publicJobs.id });
  return r!.id;
}

async function row(id: string) {
  const [r] = await conn.db
    .select()
    .from(s.publicJobs)
    .where(eq(s.publicJobs.externalId, `${PREFIX}${id}`));
  return r!;
}

async function cleanup() {
  // Las copias apuntan a un original: ON DELETE SET NULL, alcanza con borrar por prefijo
  await conn.db.delete(s.publicJobs).where(like(s.publicJobs.externalId, `${PREFIX}%`));
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
  // `rehintPool({ apply: true })` reescribe todo el pool vigente: nunca contra una base remota
  if (isRemoteDatabase(ownerUrl)) throw new Error("rehint.integration: DATABASE_URL no es local");
  await applyMigrations(ownerUrl, { log: () => {} });
  conn = createDb(ownerUrl, { max: 2 });
  await cleanup();
  const original = await seed({
    id: "orig",
    title: "Product Manager",
    roleHints: [],
    jdText: JD_ES,
  });
  await seed({ id: "legacy", title: "Product Manager", roleHints: ["producto_proyectos"] });
  await seed({ id: "empty", title: "Data Analyst", roleHints: [] });
  await seed({
    id: "lang",
    title: "Diseñador",
    roleHints: inferRoleHints({ sourceKind: "remoteok", title: "Diseñador" }),
    jdText: JD_ES,
  });
  await seed({
    id: "copy",
    title: "Product Manager",
    roleHints: [],
    jdText: JD_ES,
    dedupOfId: original,
  });
  await seed({
    id: "old",
    title: "Product Manager",
    roleHints: [],
    jdText: JD_ES,
    lastSeenAt: STALE,
  });
}, 180_000);

afterAll(async () => {
  if (conn) {
    await cleanup();
    await conn.close();
  }
  await container?.stop();
});

describe("rehintPool", () => {
  it("dry-run: informa conteos y no escribe nada", async () => {
    const before = await row("legacy");
    const r = await rehintPool(conn.db, { apply: false, now: NOW });
    expect(r.total).toBeGreaterThanOrEqual(4);
    expect(r.hintsChanged).toBeGreaterThanOrEqual(2);
    expect(r.langChanged).toBeGreaterThanOrEqual(2);
    expect(r.rowsWritten).toBe(0);
    expect(r.byLangBefore["(sin dato)"]).toBeGreaterThanOrEqual(2);
    expect(r.legacyMatrix.reduce((n, m) => n + m.count, 0)).toBeGreaterThanOrEqual(1);
    const after = await row("legacy");
    expect(after.roleHints).toEqual(before.roleHints);
    expect(after.updatedAt).toEqual(before.updatedAt);
    expect((await row("lang")).lang).toBeNull();
  });

  it("apply: corrige pistas e idioma sin tocar updated_at ni last_seen_at", async () => {
    const lang = await row("lang");
    const r = await rehintPool(conn.db, { apply: true, now: NOW, batchSize: 2 });
    expect(r.hintsChanged).toBeGreaterThanOrEqual(2);
    expect(r.rowsWritten).toBeGreaterThanOrEqual(2);
    const legacy = await row("legacy");
    expect(legacy.roleHints).not.toContain("producto_proyectos");
    expect(legacy.roleHints).toEqual(
      inferRoleHints({
        sourceKind: "remoteok",
        title: "Product Manager",
        tags: [],
        categories: [],
      }),
    );
    expect((await row("empty")).roleHints).toEqual(
      inferRoleHints({ sourceKind: "remoteok", title: "Data Analyst", tags: [], categories: [] }),
    );
    const l = await row("lang");
    expect(l.lang).toBe("es");
    expect(l.updatedAt).toEqual(lang.updatedAt);
    expect(l.lastSeenAt).toEqual(lang.lastSeenAt);
    expect(legacy.updatedAt).toEqual(UPDATED);
  });

  it("la segunda corrida con apply da 0 cambios", async () => {
    const r = await rehintPool(conn.db, { apply: true, now: NOW });
    expect(r.hintsChanged).toBe(0);
    expect(r.langChanged).toBe(0);
    expect(r.rowsWritten).toBe(0);
  });

  it("no toca copias ni filas fuera de la ventana", async () => {
    for (const id of ["copy", "old"]) {
      const x = await row(id);
      expect(x.roleHints).toEqual([]);
      expect(x.lang).toBeNull();
      expect(x.updatedAt).toEqual(UPDATED);
    }
    const [n] = await conn.db.select({ n: sql<number>`count(*)::int` }).from(s.publicJobs);
    expect(n!.n).toBeGreaterThan(0);
  });
});
