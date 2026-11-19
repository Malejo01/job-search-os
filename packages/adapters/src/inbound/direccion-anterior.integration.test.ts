import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { applyMigrations } from "@job-search-os/db/src/migrate";
import { createDb, schema as s } from "@job-search-os/db";
import { eq, sql } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { pgBlobStorage } from "../storage/blob";
import { handleInboundEmail, processInboundEvent } from "./handle";
import type { ResendReceivedEvent } from "./resend";

/** La dirección anterior sigue resolviendo como alias durante la gracia de una rotación. */
const USER = "a0000000-0000-4000-8000-0000000000e1";
const OTHER = "a0000000-0000-4000-8000-0000000000e2";
const NEW_ADDRESS = "u_nuevaaaaaaaaaaaaaaaa@ingest.test";
const OLD_ADDRESS = "u_e1000000@ingest.test";
const NOW = new Date("2026-11-19T12:00:00Z");
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

let container: StartedPostgreSqlContainer | null = null;
let conn: ReturnType<typeof createDb>;
const logger = pino({ level: "silent" });
const deps = () => ({ db: conn.db, storage: pgBlobStorage(conn.db), logger, now: () => NOW });

const event = (emailId: string, to: string): ResendReceivedEvent => ({
  type: "email.received",
  created_at: "2026-11-19T12:00:00.000Z",
  data: {
    email_id: emailId,
    from: "LinkedIn <jobs-noreply@linkedin.com>",
    to: [to],
    cc: [],
    bcc: [],
    received_for: [],
    subject: "Novedades",
    attachments: [],
  },
});

const setPrevious = (until: Date | null) =>
  conn.db
    .update(s.profiles)
    .set({ previousInboundAddress: OLD_ADDRESS, previousInboundUntil: until })
    .where(eq(s.profiles.userId, USER));

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
    .insert(s.profiles)
    .values([
      {
        userId: USER,
        displayName: "Rotada",
        locationCountry: "AR",
        inboundAddress: NEW_ADDRESS,
        profileSummary: "AI Engineer.",
      },
      {
        userId: OTHER,
        displayName: "Otra",
        locationCountry: "AR",
        inboundAddress: "u_otraaaaaaaaaaaaaaaaa@ingest.test",
        profileSummary: "AI Engineer.",
      },
    ])
    .onConflictDoNothing();
}, 180_000);

afterAll(async () => {
  await conn?.close();
  await container?.stop();
});

describe("dirección anterior durante la gracia", () => {
  it("un email a la dirección vieja dentro de la gracia se guarda para la persona correcta", async () => {
    await setPrevious(day(5));
    const ev = event("em_gracia_ok", OLD_ADDRESS);

    const out = await handleInboundEmail(ev, null, JSON.stringify(ev), deps());

    expect(out).toMatchObject({ kind: "stored", userId: USER });
  });

  it("por el webhook también: pide el cuerpo y guarda", async () => {
    await setPrevious(day(5));
    const ev = event("em_gracia_webhook", OLD_ADDRESS);
    const fetchContent = vi.fn(async () => null);

    const out = await processInboundEvent(ev, JSON.stringify(ev), fetchContent, deps());

    expect(out).toMatchObject({ kind: "stored", userId: USER });
    expect(fetchContent).toHaveBeenCalledTimes(1);
  });

  it("pasada la gracia termina en unknown_recipient, como hoy", async () => {
    await setPrevious(day(-1));
    const ev = event("em_gracia_vencida", OLD_ADDRESS);

    const out = await handleInboundEmail(ev, null, JSON.stringify(ev), deps());
    expect(out).toMatchObject({ kind: "unknown_recipient" });

    const webhook = await processInboundEvent(
      event("em_gracia_vencida_2", OLD_ADDRESS),
      "{}",
      vi.fn(async () => null),
      deps(),
    );
    expect(webhook).toMatchObject({ kind: "unknown_recipient" });
  });

  it("sin fecha de vencimiento la dirección vieja no resuelve", async () => {
    await setPrevious(null);
    const ev = event("em_gracia_sin_fecha", OLD_ADDRESS);
    expect(await handleInboundEmail(ev, null, JSON.stringify(ev), deps())).toMatchObject({
      kind: "unknown_recipient",
    });
  });

  it("la dirección actual sigue resolviendo", async () => {
    await setPrevious(day(5));
    const ev = event("em_gracia_actual", NEW_ADDRESS);
    expect(await handleInboundEmail(ev, null, JSON.stringify(ev), deps())).toMatchObject({
      kind: "stored",
      userId: USER,
    });
  });

  it("la resolución por dirección anterior usa índice, sin Seq Scan sobre profiles", async () => {
    await conn.db.execute(sql`
      INSERT INTO profiles (user_id, display_name, location_country, inbound_address, previous_inbound_address, previous_inbound_until)
      SELECT gen_random_uuid(), 'Relleno', 'AR', 'u_relleno' || g || '@ingest.test', 'u_viejo' || g || '@ingest.test', now() + interval '3 days'
      FROM generate_series(1, 5000) g
    `);
    await conn.db.execute(sql`ANALYZE profiles`);

    const plan = (await conn.db.execute(sql`
      EXPLAIN SELECT user_id FROM profiles
      WHERE previous_inbound_address IN ('u_viejo77@ingest.test') AND previous_inbound_until > now()
    `)) as unknown as Record<string, string>[];
    const text = plan.map((r) => Object.values(r)[0]).join("\n");

    expect(text).not.toMatch(/Seq Scan on profiles/);
  });
});
