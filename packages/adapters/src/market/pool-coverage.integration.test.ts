import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { applyMigrations } from "@job-search-os/db/src/migrate";
import { createDb, isRemoteDatabase, schema as s } from "@job-search-os/db";
import { buildPoolCoverage } from "@job-search-os/pipeline";
import { like } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { POOL_PARSER } from "../inbound/pool-mailbox";
import { readPoolCoverage, readPoolMailboxActivity } from "./pool-coverage";

/**
 * R16-4 · Cobertura del pool por carrera y fuente. Datos inventados, con prefijo propio y con carreras
 * inventadas (`r16-4-a`, `r16-4-b`): la consulta recibe la lista de carreras, así que ninguna otra prueba ni
 * dato de la base compartida entra en los números. Se limpia lo que se crea.
 */
const PREFIX = "pool-coverage-test-";
const ROLE_A = "r16-4-a";
const ROLE_B = "r16-4-b";
const NOW = new Date("2026-11-13T12:00:00Z");
const day = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

let container: StartedPostgreSqlContainer | null = null;
let conn: ReturnType<typeof createDb>;
let seq = 0;

async function pool(over: Partial<typeof s.publicJobs.$inferInsert> = {}) {
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
      roleHints: [ROLE_A],
      firstSeenAt: day(40),
      lastSeenAt: day(1),
      ...over,
    })
    .returning({ id: s.publicJobs.id });
  return row!.id;
}

const read = (roles: string[] = [ROLE_A, ROLE_B]) => readPoolCoverage(conn.db, roles, NOW);
const find = (rows: Awaited<ReturnType<typeof read>>, role: string, source: string) =>
  rows.find((r) => r.role === role && r.source === source);

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
  if (isRemoteDatabase(ownerUrl))
    throw new Error("pool-coverage.integration: DATABASE_URL no es local");
  await applyMigrations(ownerUrl, { log: () => {} });
  conn = createDb(ownerUrl, { max: 2 });
}, 180_000);

const clean = () => conn.db.delete(s.publicJobs).where(like(s.publicJobs.externalId, `${PREFIX}%`));

beforeEach(clean);

afterAll(async () => {
  await clean();
  await conn?.close();
  await container?.stop();
});

describe("readPoolCoverage", () => {
  it("cuenta por carrera y fuente, en 7 y en 30 días, según last_seen_at", async () => {
    await pool({ lastSeenAt: day(1) }); // 7 y 30
    await pool({ lastSeenAt: day(6) }); // 7 y 30
    await pool({ lastSeenAt: day(10) }); // solo 30
    await pool({ lastSeenAt: day(29) }); // solo 30
    await pool({ lastSeenAt: day(31) }); // ninguna ventana
    await pool({ sourceKind: "wwr", lastSeenAt: day(2) });
    const rows = await read();
    expect(find(rows, ROLE_A, "remoteok")).toMatchObject({ active7: 2, active30: 4 });
    expect(find(rows, ROLE_A, "wwr")).toMatchObject({ active7: 1, active30: 1 });
  });

  it("no mira cuándo se publicó ni cuándo entró: una oferta vieja que la fuente sigue listando es activa", async () => {
    await pool({ firstSeenAt: day(90), postedAt: day(120), lastSeenAt: day(1) });
    await pool({ firstSeenAt: day(2), postedAt: day(2), lastSeenAt: day(40) }); // nueva pero ya no listada
    expect(find(await read(), ROLE_A, "remoteok")).toMatchObject({ active7: 1, active30: 1 });
  });

  it("deja afuera las copias", async () => {
    const original = await pool({});
    await pool({ dedupOfId: original });
    expect(find(await read(), ROLE_A, "remoteok")?.active30).toBe(1);
  });

  it("un aviso con varias carreras cuenta una vez en cada una", async () => {
    await pool({ roleHints: [ROLE_A, ROLE_B] });
    await pool({ roleHints: [ROLE_B, "r16-4-otra"] });
    const rows = await read();
    expect(find(rows, ROLE_A, "remoteok")?.active30).toBe(1);
    expect(find(rows, ROLE_B, "remoteok")?.active30).toBe(2);
    // la carrera que no se pidió no aparece
    expect(rows.some((r) => r.role === "r16-4-otra")).toBe(false);
  });

  it("«en español» usa el idioma calculado y, si falta, el de la fuente; sin dato no cuenta", async () => {
    await pool({ jdLanguage: "es", lastSeenAt: day(1) });
    await pool({ jdLanguage: "en", lang: "es", lastSeenAt: day(1) }); // el calculado manda
    await pool({ jdLanguage: null, lang: "es", lastSeenAt: day(20) });
    await pool({ jdLanguage: null, lang: null, lastSeenAt: day(1) });
    expect(find(await read(), ROLE_A, "remoteok")).toMatchObject({
      active7: 3,
      active30: 4,
      spanish7: 1,
      spanish30: 2,
    });
  });

  it("devuelve solo números: ninguna fila trae texto de un aviso", async () => {
    await pool({});
    const rows = await read();
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(
        ["active30", "active7", "role", "source", "spanish30", "spanish7"].sort(),
      );
    }
    expect(JSON.stringify(rows)).not.toContain("Empresa Ficticia");
    expect(JSON.stringify(rows)).not.toContain("example.com");
  });

  it("sin carreras no lee nada, y una carrera sin ofertas queda en cero en la tabla armada", async () => {
    expect(await read([])).toEqual([]);
    await pool({});
    const table = buildPoolCoverage([ROLE_A, ROLE_B], await read());
    expect(table.find((r) => r.role === ROLE_B)).toMatchObject({ active30: 0, low: true });
  });
});

describe("readPoolMailboxActivity (R19-04)", () => {
  const ref = `${PREFIX}mail`;
  const cleanMail = () =>
    conn.db.delete(s.inboundEmails).where(like(s.inboundEmails.rawRef, `${ref}%`));
  afterAll(cleanMail);

  it("fecha por carrera de los avisos por email, interruptores y último email de la cola", async () => {
    await pool({ sourceKind: "computrabajo_alerts", lastSeenAt: day(5) });
    await pool({ sourceKind: "computrabajo_alerts", lastSeenAt: day(2) });
    await pool({ sourceKind: "computrabajo_alerts", lastSeenAt: day(9), roleHints: [ROLE_B] });
    await pool({ sourceKind: "remoteok", lastSeenAt: day(0) }); // otra fuente: no cuenta
    const future = new Date("2099-01-01T00:00:00Z");
    await conn.db.insert(s.inboundEmails).values({
      userId: null,
      fromAddress: "alertas@example.com",
      rawRef: `${ref}1`,
      parser: POOL_PARSER,
      receivedAt: future,
    });
    try {
      const off = await readPoolMailboxActivity(conn.db, [ROLE_A, ROLE_B, "r16-4-c"], {});
      expect(off).toMatchObject({ mailboxesOn: false, readerOn: false });
      expect(off.lastQueueEmailAt?.toISOString()).toBe(future.toISOString());
      expect(off.lastAlertByRole).toEqual([
        { role: ROLE_A, lastAt: day(2), offers: 2 },
        { role: ROLE_B, lastAt: day(9), offers: 1 },
        { role: "r16-4-c", lastAt: null, offers: 0 },
      ]);
      const on = await readPoolMailboxActivity(conn.db, [], {
        POOL_SOURCE_COMPUTRABAJO_ALERTS: "1",
        POOL_COMPUTRABAJO_READER: "1",
      });
      expect(on).toMatchObject({ mailboxesOn: true, readerOn: true, lastAlertByRole: [] });
      // Solo "1" prende el lector
      const odd = await readPoolMailboxActivity(conn.db, [], { POOL_COMPUTRABAJO_READER: "on" });
      expect(odd.readerOn).toBe(false);
    } finally {
      await cleanMail();
    }
  });
});
