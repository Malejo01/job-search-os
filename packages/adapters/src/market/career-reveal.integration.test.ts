import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { applyMigrations } from "@job-search-os/db/src/migrate";
import { createDb, schema as s } from "@job-search-os/db";
import { like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readCareerRevealCounts } from "./career-reveal";

/** Carreras ocultas (C4-3): cuenta ofertas nuevas y vigentes por carrera, sin copias. Datos inventados. */
const PREFIX = "careerreveal-test-";
const NOW = new Date("2026-11-10T12:00:00Z");
const day = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

let container: StartedPostgreSqlContainer | null = null;
let conn: ReturnType<typeof createDb>;
let seq = 0;

async function pool(roleHints: string[], over: Partial<typeof s.publicJobs.$inferInsert> = {}) {
  const n = ++seq;
  const [row] = await conn.db
    .insert(s.publicJobs)
    .values({
      sourceKind: "remoteok",
      externalId: `${PREFIX}${n}`,
      sourceName: "Remote OK",
      sourceUrl: `https://example.com/jobs/${PREFIX}${n}`,
      title: `Puesto ficticio ${n}`,
      titleNormalized: `puesto ficticio ${n}`,
      companyRaw: `Empresa Ficticia ${n}`,
      companyNormalized: `empresa ficticia ${n}`,
      roleHints,
      postedAt: day(2),
      firstSeenAt: day(2),
      lastSeenAt: NOW,
      ...over,
    })
    .returning({ id: s.publicJobs.id });
  return row!.id;
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
  await conn.db.delete(s.publicJobs).where(like(s.publicJobs.externalId, `${PREFIX}%`));

  // abogacia: 2 nuevas dentro de la ventana, 1 vieja pero vista hace poco (vigente, no nueva),
  // 1 copia y 1 fuera de la ventana
  await pool(["abogacia"]);
  await pool(["abogacia", "comunicacion"]);
  await pool(["abogacia"], { firstSeenAt: day(60), lastSeenAt: day(5) });
  const original = await pool(["frontend"]);
  await pool(["abogacia"], { dedupOfId: original });
  await pool(["abogacia"], { firstSeenAt: day(90), lastSeenAt: day(45) });
  // Una carrera que no se pide, y una sin hints
  await pool(["frontend", "backend"]);
  await pool([]);
}, 180_000);

afterAll(async () => {
  if (conn) await conn.db.delete(s.publicJobs).where(like(s.publicJobs.externalId, `${PREFIX}%`));
  await conn?.close();
  await container?.stop();
});

describe("readCareerRevealCounts", () => {
  it("cuenta nuevas y vigentes por carrera pedida, sin copias ni avisos fuera de la ventana", async () => {
    const rows = await readCareerRevealCounts(conn.db, ["abogacia", "comunicacion"], NOW);
    const by = Object.fromEntries(rows.map((r) => [r.role, r]));
    expect(by.abogacia).toEqual({ role: "abogacia", received: 2, active: 3 });
    expect(by.comunicacion).toEqual({ role: "comunicacion", received: 1, active: 1 });
  });

  it("no devuelve carreras que no se pidieron ni inventa filas para las que no tienen ofertas", async () => {
    const rows = await readCareerRevealCounts(conn.db, ["abogacia", "ventas_b2b"], NOW);
    expect(rows.map((r) => r.role)).toEqual(["abogacia"]);
  });

  it("sin carreras pedidas no consulta nada", async () => {
    expect(await readCareerRevealCounts(conn.db, [], NOW)).toEqual([]);
  });
});
