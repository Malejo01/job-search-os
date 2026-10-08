import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { needsAttention } from "@job-search-os/pipeline";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "../schema";
import { inboxWhere } from "./inbox-views";
import { applyMigrations } from "./migrate";

/**
 * Paridad de las pestañas de /inbox (ronda 19): las condiciones SQL de `inboxWhere` devuelven
 * exactamente lo que dice `needsAttention` sobre una matriz de filas (con y sin error, parser
 * nulo / none / gmail_reenvio / otro, con y sin avisos, sin marcar / visto / descartado). Cada fila
 * cae en una sola pestaña. Mismos entornos que rls.integration.test.ts (CI: DATABASE_URL; local:
 * Testcontainer). Datos inventados.
 */
const USER = "cccccccc-0000-4000-8000-000000000001";
const SEEN = new Date("2026-10-01T10:00:00Z");

let container: StartedPostgreSqlContainer | null = null;
let owner: Sql;
let db: ReturnType<typeof drizzle<typeof schema>>;

type Case = {
  key: string;
  error: string | null;
  parser: string | null;
  jobs: number;
  seen: boolean;
  dismissed: boolean;
};

const cases: Case[] = [];
for (const error of [null, "cola manual"])
  for (const parser of [null, "none", "gmail_reenvio", "linkedin"])
    for (const jobs of [0, 2])
      for (const [seen, dismissed] of [
        [false, false],
        [true, false],
        [false, true],
        [true, true],
      ] as const)
        cases.push({
          key: `${error ?? "ok"}|${parser ?? "null"}|${jobs}|${seen ? "s" : "-"}${dismissed ? "d" : "-"}`,
          error,
          parser,
          jobs,
          seen,
          dismissed,
        });

beforeAll(async () => {
  let ownerUrl: string;
  if (process.env.DATABASE_URL) {
    ownerUrl = process.env.DATABASE_URL;
  } else {
    container = await new PostgreSqlContainer("pgvector/pgvector:pg16")
      .withDatabase("jobsearch")
      .withUsername("postgres")
      .withPassword("postgres")
      .start();
    ownerUrl = container.getConnectionUri();
  }
  await applyMigrations(ownerUrl, { log: () => {} });
  owner = postgres(ownerUrl, { max: 1, prepare: false });
  db = drizzle(owner, { schema });
  await owner`insert into users (id, email) values (${USER}, 'a@pendientes.test')`;
  await db.insert(schema.inboundEmails).values(
    cases.map((c) => ({
      userId: USER,
      fromAddress: "Remitente <aviso@example.com>",
      subject: c.key, // el asunto identifica el caso
      rawRef: "pg:no-existe",
      parser: c.parser,
      jobsExtracted: c.jobs,
      error: c.error,
      seenAt: c.seen ? SEEN : null,
      dismissedAt: c.dismissed ? SEEN : null,
    })),
  );
}, 180_000);

afterAll(async () => {
  if (owner) {
    await owner`delete from inbound_emails where user_id = ${USER}`;
    await owner`delete from users where id = ${USER}`;
  }
  await owner?.end();
  await container?.stop();
});

const subjectsOf = async (where: Parameters<typeof and>[0]) =>
  (
    await db
      .select({ subject: schema.inboundEmails.subject })
      .from(schema.inboundEmails)
      .where(and(eq(schema.inboundEmails.userId, USER), where))
  )
    .map((r) => r.subject!)
    .sort();

const asRow = (c: Case) => ({
  parser: c.parser,
  jobsExtracted: c.jobs,
  error: c.error,
  seenAt: c.seen ? SEEN : null,
  dismissedAt: c.dismissed ? SEEN : null,
});

describe("pestañas de /inbox: SQL = needsAttention", () => {
  it("Pendientes devuelve exactamente las filas que needsAttention marca", async () => {
    const expected = cases
      .filter((c) => needsAttention(asRow(c)))
      .map((c) => c.key)
      .sort();
    expect(expected.length).toBeGreaterThan(0);
    expect(expected.length).toBeLessThan(cases.length);
    expect(await subjectsOf(inboxWhere.pendientes)).toEqual(expected);
  });

  it("Vistos = no descartado y (visto o resuelto solo); Descartados = con dismissed_at", async () => {
    const resueltoSolo = (c: Case) =>
      !needsAttention({ ...asRow(c), seenAt: null, dismissedAt: null });
    expect(await subjectsOf(inboxWhere.vistos)).toEqual(
      cases
        .filter((c) => !c.dismissed && (c.seen || resueltoSolo(c)))
        .map((c) => c.key)
        .sort(),
    );
    expect(await subjectsOf(inboxWhere.descartados)).toEqual(
      cases
        .filter((c) => c.dismissed)
        .map((c) => c.key)
        .sort(),
    );
  });

  it("cada fila cae en una sola pestaña: nada queda solo en «Todos»", async () => {
    const all = cases.map((c) => c.key).sort();
    const p = await subjectsOf(inboxWhere.pendientes);
    const v = await subjectsOf(inboxWhere.vistos);
    const d = await subjectsOf(inboxWhere.descartados);
    expect([...p, ...v, ...d].sort()).toEqual(all);
    expect(new Set([...p, ...v, ...d]).size).toBe(all.length);
  });
});
