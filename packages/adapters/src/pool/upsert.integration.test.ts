import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { applyMigrations } from "@job-search-os/db/src/migrate";
import { createDb, schema as s } from "@job-search-os/db";
import { compileTaxonomy, type RawJob } from "@job-search-os/pipeline";
import { eq, inArray, like, sql } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { upsertPoolJobs } from "./upsert";

/**
 * Ronda 37 · Upsert del pool global. Sin red ni LLM; avisos inventados (Empresa Ficticia N).
 * Corre como dueño, igual que el servicio.
 */
const PREFIX = "upsert-test-";
const logger = pino({ level: "silent" });
const T0 = new Date("2026-10-12T12:00:00Z");
const T1 = new Date("2026-10-12T18:00:00Z");

let container: StartedPostgreSqlContainer | null = null;
let conn: ReturnType<typeof createDb>;
const taxonomy = compileTaxonomy([
  { slug: "pool_zorgdb", name: "Zorgdb", aliases: [] },
  { slug: "pool_quuxlang", name: "Quuxlang", aliases: [] },
]);

const JD_A =
  "Buscamos una persona backend con Zorgdb para sumarse a un equipo remoto. Escribir a rrhh@example.com " +
  "o llamar al +44 20 7946 0958. Trabajamos con pruebas automatizadas, despliegues continuos y revisión " +
  "de código entre pares todos los días de la semana.";
const JD_B =
  "El equipo de diseño necesita alguien que arme prototipos de interfaces, mantenga el sistema visual y " +
  "colabore con producto en entrevistas de usuarios cada quincena, con foco en accesibilidad y claridad.";
const JD_C =
  "Se necesita analista para modelar datos de ventas, armar tableros y explicar los resultados a las " +
  "áreas comerciales cada mes, usando consultas y herramientas de visualización conocidas por todos.";

function rawJob(over: Partial<RawJob> & { id: string }): RawJob {
  const { id, ...rest } = over;
  return {
    source: {
      kind: "remoteok",
      name: "Remote OK",
      externalId: `${PREFIX}${id}`,
      url: `https://example.com/jobs/${PREFIX}${id}`,
      rawRef: null,
      original: { contentType: "application/json", body: JSON.stringify({ id }) },
    },
    title: "Backend Developer",
    companyRaw: "Empresa Ficticia 1",
    locationRaw: "Worldwide",
    countriesAllowed: null,
    modality: "remoto",
    contractType: null,
    salaryMinUsd: null,
    salaryMaxUsd: null,
    salaryPeriod: null,
    salaryNote: null,
    weeklyHours: null,
    candidatesCount: null,
    badges: [],
    jdText: JD_A,
    postedAt: null,
    tags: ["backend"],
    categories: ["engineering"],
    seniority: null,
    lang: null,
    ...rest,
  };
}

async function row(id: string) {
  const [r] = await conn.db
    .select()
    .from(s.publicJobs)
    .where(eq(s.publicJobs.externalId, `${PREFIX}${id}`));
  return r!;
}

async function count(table: typeof s.jobs | typeof s.jobSources) {
  const [r] = await conn.db.select({ n: sql<number>`count(*)::int` }).from(table);
  return r!.n;
}

async function poolBlobCount(): Promise<number> {
  const [r] = await conn.db
    .select({ n: sql<number>`count(*)::int` })
    .from(s.rawBlobs)
    .where(like(s.rawBlobs.kind, "pool\\_%"));
  return r!.n;
}

async function cleanup() {
  const mine = await conn.db
    .select({ id: s.publicJobs.id, rawRef: s.publicJobs.rawRef })
    .from(s.publicJobs)
    .where(like(s.publicJobs.externalId, `${PREFIX}%`));
  await conn.db.delete(s.publicJobs).where(
    inArray(
      s.publicJobs.id,
      mine.map((m) => m.id),
    ),
  );
  const blobIds = mine.map((m) => m.rawRef?.slice(3)).filter((x): x is string => Boolean(x));
  if (blobIds.length) await conn.db.delete(s.rawBlobs).where(inArray(s.rawBlobs.id, blobIds));
}

async function slugsOf(publicJobId: string): Promise<string[]> {
  const rows = await conn.db
    .select({ slug: s.skills.slug })
    .from(s.publicJobSkills)
    .innerJoin(s.skills, eq(s.skills.id, s.publicJobSkills.skillId))
    .where(eq(s.publicJobSkills.publicJobId, publicJobId));
  return rows.map((r) => r.slug).sort();
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
  await conn.db
    .insert(s.skills)
    .values([
      { slug: "pool_zorgdb", name: "Zorgdb", category: "otra" },
      { slug: "pool_quuxlang", name: "Quuxlang", category: "otra" },
    ])
    .onConflictDoNothing();
  await cleanup();
}, 180_000);

afterAll(async () => {
  if (conn) {
    await cleanup();
    await conn.db.delete(s.skills).where(like(s.skills.slug, "pool\\_%"));
    await conn.close();
  }
  await container?.stop();
});

describe("upsertPoolJobs", () => {
  it("primera corrida inserta; la segunda con lo mismo no inserta y solo avanza last_seen_at", async () => {
    const jobsBefore = await count(s.jobs);
    const sourcesBefore = await count(s.jobSources);
    const batch = [
      rawJob({ id: "a" }),
      rawJob({
        id: "b",
        title: "Product Designer",
        companyRaw: "Empresa Ficticia 2",
        jdText: JD_B,
        tags: ["design"],
        categories: ["design"],
      }),
      rawJob({ id: "c", title: "Data Analyst", companyRaw: "Empresa Ficticia 3", jdText: JD_C }),
    ];
    const first = await upsertPoolJobs(batch, { db: conn.db, logger, now: () => T0, taxonomy });
    expect(first).toEqual({
      received: 3,
      inserted: 3,
      updated: 0,
      unchanged: 0,
      copies: 0,
      skipped: 0,
      errors: 0,
      stopped: false,
    });
    const blobsAfterFirst = await conn.db.select({ id: s.rawBlobs.id }).from(s.rawBlobs);

    const second = await upsertPoolJobs(batch, { db: conn.db, logger, now: () => T1, taxonomy });
    expect(second).toMatchObject({ inserted: 0, updated: 0, unchanged: 3, copies: 0, errors: 0 });
    expect((await row("a")).lastSeenAt).toEqual(T1);
    expect((await row("a")).firstSeenAt).toEqual(T0);
    // Lo repetido no guarda un crudo nuevo cada vez
    expect(await conn.db.select({ id: s.rawBlobs.id }).from(s.rawBlobs)).toHaveLength(
      blobsAfterFirst.length,
    );

    // El pool no asigna: no crea filas de usuario
    expect(await count(s.jobs)).toBe(jobsBefore);
    expect(await count(s.jobSources)).toBe(sourcesBefore);
  });

  it("guarda role_hints y categories, y los datos de la fuente", async () => {
    const a = await row("a");
    // El tag "backend" de Remote OK cuenta como desarrollo (SOURCE_CATEGORY_ROLES)
    expect(a.roleHints).toEqual(["frontend", "backend", "fullstack"]);
    expect(a.categories).toEqual(["engineering"]);
    expect(a.tags).toEqual(["backend"]);
    expect(a.sourceName).toBe("Remote OK");
    expect(a.sourceUrl).toBe(`https://example.com/jobs/${PREFIX}a`);
    expect(a.companyNormalized).toBe("empresa ficticia 1");
    expect(a.companyId).not.toBeNull();
    expect((await row("b")).roleHints).toEqual(["ux_ui"]);
  });

  it("una fila con role_hints viejos recibe las pistas nuevas sin crudo nuevo y cuenta como unchanged", async () => {
    const same = rawJob({
      id: "b",
      title: "Product Designer",
      companyRaw: "Empresa Ficticia 2",
      jdText: JD_B,
      tags: ["design"],
      categories: ["design"],
    });
    const before = await row("b");
    await conn.db.update(s.publicJobs).set({ roleHints: [] }).where(eq(s.publicJobs.id, before.id));
    const blobs = await poolBlobCount();

    const summary = await upsertPoolJobs([same], {
      db: conn.db,
      logger,
      now: () => T1,
      taxonomy,
    });

    expect(summary).toMatchObject({ inserted: 0, updated: 0, unchanged: 1, errors: 0 });
    const after = await row("b");
    expect(after.roleHints).toEqual(["ux_ui"]);
    expect(after.rawRef).toBe(before.rawRef);
    expect(after.updatedAt).toEqual(before.updatedAt);
    expect(after.lastSeenAt).toEqual(T1);
    expect(await poolBlobCount()).toBe(blobs);
  });

  it("si las pistas no cambian, un segundo upsert solo avanza last_seen_at", async () => {
    const same = rawJob({
      id: "b",
      title: "Product Designer",
      companyRaw: "Empresa Ficticia 2",
      jdText: JD_B,
      tags: ["design"],
      categories: ["design"],
    });
    const before = await row("b");
    const summary = await upsertPoolJobs([same], {
      db: conn.db,
      logger,
      now: () => new Date("2026-10-12T20:00:00Z"),
      taxonomy,
    });
    expect(summary).toMatchObject({ inserted: 0, updated: 0, unchanged: 1, errors: 0 });
    const after = await row("b");
    expect(after.roleHints).toEqual(before.roleHints);
    expect(after.updatedAt).toEqual(before.updatedAt);
    expect(after.rawRef).toBe(before.rawRef);
  });

  it("emails y teléfonos no quedan en jd_text", async () => {
    const a = await row("a");
    expect(a.jdText).toContain("[contacto]");
    expect(a.jdText).not.toContain("rrhh@example.com");
    expect(a.jdText).not.toContain("7946");
  });

  it("el crudo va a raw_blobs sin usuario y con kind pool_<fuente>", async () => {
    const a = await row("a");
    expect(a.rawRef).toMatch(/^pg:/);
    const [blob] = await conn.db
      .select({ userId: s.rawBlobs.userId, kind: s.rawBlobs.kind })
      .from(s.rawBlobs)
      .where(eq(s.rawBlobs.id, a.rawRef!.slice(3)));
    expect(blob).toEqual({ userId: null, kind: "pool_remoteok" });
  });

  it("calcula las skills del pool desde el JD", async () => {
    expect(await slugsOf((await row("a")).id)).toEqual(["pool_zorgdb"]);
  });

  it("JD cambiada: updated, skills recalculadas y el crudo nuevo reemplaza al anterior", async () => {
    const before = await row("a");
    const changed = rawJob({
      id: "a",
      title: "Backend Engineer",
      jdText: JD_A.replace("Zorgdb", "Quuxlang"),
    });
    const out = await upsertPoolJobs([changed], {
      db: conn.db,
      logger,
      now: () => T1,
      taxonomy,
    });
    expect(out).toMatchObject({ inserted: 0, updated: 1, unchanged: 0 });
    const after = await row("a");
    expect(after.jdHash).not.toBe(before.jdHash);
    expect(after.title).toBe("Backend Engineer");
    expect(after.id).toBe(before.id);
    expect(await slugsOf(after.id)).toEqual(["pool_quuxlang"]);
    expect(after.rawRef).not.toBe(before.rawRef);
    const old = await conn.db
      .select({ id: s.rawBlobs.id })
      .from(s.rawBlobs)
      .where(eq(s.rawBlobs.id, before.rawRef!.slice(3)));
    expect(old).toHaveLength(0);
  });

  it("el mismo aviso desde otra fuente es fila nueva con dedup_of_id a la raíz y sin perder texto", async () => {
    const root = await row("b");
    // Misma URL canónica, otra fuente y otro JD
    const sameUrl = rawJob({
      id: "b-jobicy",
      title: "Product Designer",
      companyRaw: "Empresa Ficticia 2",
      jdText: `${JD_B} Versión de otra fuente.`,
      source: {
        kind: "jobicy",
        name: "Jobicy",
        externalId: `${PREFIX}b-jobicy`,
        url: `https://example.com/jobs/${PREFIX}b?utm_source=otra`,
        rawRef: null,
        original: { contentType: "application/json", body: "{}" },
      },
    });
    // Mismo JD, otra URL, misma empresa
    const sameText = rawJob({
      id: "b-himalayas",
      title: "UX Designer",
      companyRaw: "Empresa Ficticia 2",
      jdText: JD_B,
      source: {
        kind: "himalayas",
        name: "Himalayas",
        externalId: `${PREFIX}b-himalayas`,
        url: `https://example.com/otra/${PREFIX}b-himalayas`,
        rawRef: null,
        original: { contentType: "application/json", body: "{}" },
      },
    });
    const out = await upsertPoolJobs([sameUrl, sameText], {
      db: conn.db,
      logger,
      now: () => T1,
      taxonomy,
    });
    expect(out).toMatchObject({ inserted: 0, copies: 2, errors: 0 });
    const copy1 = await row("b-jobicy");
    const copy2 = await row("b-himalayas");
    expect(copy1.dedupOfId).toBe(root.id);
    expect(copy2.dedupOfId).toBe(root.id);
    // Ningún texto se pierde: las tres filas conservan su JD
    expect(copy1.jdText).toContain("Versión de otra fuente");
    expect(copy2.jdText).toBe(JD_B);
    expect((await row("b")).jdText).toBe(JD_B);
    expect((await row("b")).dedupOfId).toBeNull();
  });

  it("un aviso sin externalId o sin URL se salta", async () => {
    const noId = rawJob({ id: "x" });
    noId.source.externalId = null;
    const noUrl = rawJob({ id: "y" });
    noUrl.source.url = null;
    const out = await upsertPoolJobs([noId, noUrl], {
      db: conn.db,
      logger,
      now: () => T1,
      taxonomy,
    });
    expect(out).toMatchObject({ received: 2, skipped: 2, inserted: 0, errors: 0 });
    const rows = await conn.db
      .select({ id: s.publicJobs.id })
      .from(s.publicJobs)
      .where(inArray(s.publicJobs.externalId, [`${PREFIX}x`, `${PREFIX}y`]));
    expect(rows).toHaveLength(0);
  });

  it("un error en un aviso no corta el lote", async () => {
    // Un enum inválido hace fallar el insert de ese aviso solamente
    const bad = rawJob({ id: "bad", modality: "inexistente" as never });
    const good = rawJob({
      id: "good",
      companyRaw: "Empresa Ficticia 4",
      jdText: JD_C.replace("ventas", "compras"),
    });
    const blobsBefore = await poolBlobCount();
    const out = await upsertPoolJobs([bad, good], {
      db: conn.db,
      logger,
      now: () => T1,
      taxonomy,
    });
    expect(out).toMatchObject({ errors: 1, inserted: 1 });
    expect((await row("good")).id).toBeTruthy();
    // El crudo del aviso que falló no queda huérfano: solo suma el del que entró
    expect(await poolBlobCount()).toBe(blobsBefore + 1);
  });

  it("una URL que no es http/https se salta (javascript:, data:)", async () => {
    const js = rawJob({ id: "js" });
    js.source.url = "javascript:alert(1)";
    const data = rawJob({ id: "data" });
    data.source.url = "data:text/html,<script>alert(1)</script>";
    const out = await upsertPoolJobs([js, data], { db: conn.db, logger, now: () => T1, taxonomy });
    expect(out).toMatchObject({ received: 2, skipped: 2, inserted: 0, errors: 0 });
    const rows = await conn.db
      .select({ id: s.publicJobs.id })
      .from(s.publicJobs)
      .where(inArray(s.publicJobs.externalId, [`${PREFIX}js`, `${PREFIX}data`]));
    expect(rows).toHaveLength(0);
  });

  it("ningún email ni teléfono queda en título, empresa, ubicación, JD ni crudo", async () => {
    const original = {
      contentType: "application/json",
      body: JSON.stringify({
        id: 12345678,
        position: "Dev, escribir a jefe@example.com",
        contact: "rrhh@example.com",
        phone: "+44 20 7946 0958",
        nested: [{ note: "Llamar al 020 7946 0958" }],
        url: "https://example.com/jobs/12345678",
      }),
    };
    const raw = rawJob({
      id: "contacts",
      title: "Backend Developer (jefe@example.com)",
      companyRaw: "Empresa Ficticia 5 +44 20 7946 0958",
      locationRaw: "Remoto, tel +44 20 7946 0958",
      jdText: `${JD_B} Info: talento@example.com`,
    });
    raw.source.original = original;
    const textual = rawJob({
      id: "contacts-text",
      companyRaw: "Empresa Ficticia 12",
      jdText: `${JD_C} Crudo de texto.`,
    });
    textual.source.original = {
      contentType: "text/plain",
      body: "no es json rrhh@example.com +44 20 7946 0958",
    };
    const out = await upsertPoolJobs([raw, textual], {
      db: conn.db,
      logger,
      now: () => T1,
      taxonomy,
    });
    expect(out).toMatchObject({ inserted: 2, errors: 0 });
    const a = await row("contacts");
    const b = await row("contacts-text");
    for (const text of [a.title, a.companyRaw, a.locationRaw, a.jdText]) {
      expect(text).not.toMatch(/@|7946/);
    }
    for (const ref of [a.rawRef, b.rawRef]) {
      const [blob] = await conn.db
        .select({ body: s.rawBlobs.body })
        .from(s.rawBlobs)
        .where(eq(s.rawBlobs.id, ref!.slice(3)));
      expect(blob!.body).not.toMatch(/@|7946/);
    }
    // El JSON sigue siendo JSON y el id numérico quedó intacto
    const [json] = await conn.db
      .select({ body: s.rawBlobs.body })
      .from(s.rawBlobs)
      .where(eq(s.rawBlobs.id, a.rawRef!.slice(3)));
    const parsed = JSON.parse(json!.body);
    expect(parsed.id).toBe(12345678);
    expect(parsed.url).toBe("https://example.com/jobs/12345678");
    expect(parsed.contact).toBe("[contacto]");
  });

  it("mismo JD con sueldo agregado: updated, crudo nuevo y el viejo se borra", async () => {
    const base = rawJob({
      id: "salary",
      companyRaw: "Empresa Ficticia 6",
      jdText: JD_C + " Extra.",
    });
    await upsertPoolJobs([base], { db: conn.db, logger, now: () => T0, taxonomy });
    const before = await row("salary");
    const withSalary = rawJob({
      id: "salary",
      companyRaw: "Empresa Ficticia 6",
      jdText: JD_C + " Extra.",
      salaryMinUsd: 2000,
      salaryMaxUsd: 2500,
      salaryPeriod: "mensual",
    });
    const out = await upsertPoolJobs([withSalary], {
      db: conn.db,
      logger,
      now: () => T1,
      taxonomy,
    });
    expect(out).toMatchObject({ updated: 1, unchanged: 0, inserted: 0 });
    const after = await row("salary");
    expect(after.jdHash).toBe(before.jdHash);
    expect([after.salaryMinUsd, after.salaryMaxUsd, after.salaryPeriod]).toEqual([
      2000,
      2500,
      "mensual",
    ]);
    expect(after.rawRef).not.toBe(before.rawRef);
    expect(after.lastSeenAt).toEqual(T1);
    const old = await conn.db
      .select({ id: s.rawBlobs.id })
      .from(s.rawBlobs)
      .where(eq(s.rawBlobs.id, before.rawRef!.slice(3)));
    expect(old).toHaveLength(0);
    // Una tercera corrida igual ya no cambia nada
    const again = await upsertPoolJobs([withSalary], {
      db: conn.db,
      logger,
      now: () => T1,
      taxonomy,
    });
    expect(again).toMatchObject({ updated: 0, unchanged: 1 });
  });

  it("una fila sin skills pero con JD las rehace aunque no haya cambiado", async () => {
    const raw = rawJob({ id: "repair", companyRaw: "Empresa Ficticia 7" });
    await upsertPoolJobs([raw], { db: conn.db, logger, now: () => T0, taxonomy });
    const r = await row("repair");
    expect(await slugsOf(r.id)).toEqual(["pool_zorgdb"]);
    await conn.db.delete(s.publicJobSkills).where(eq(s.publicJobSkills.publicJobId, r.id));
    const out = await upsertPoolJobs([raw], { db: conn.db, logger, now: () => T1, taxonomy });
    expect(out).toMatchObject({ unchanged: 1, updated: 0 });
    expect(await slugsOf(r.id)).toEqual(["pool_zorgdb"]);
  });

  it("shouldStop corta el lote y lo informa", async () => {
    // shouldStop se consulta antes de cada lote: tres boards distintos son tres lotes
    const atsJob = (id: string, over: Partial<RawJob>) => {
      const j = rawJob({ id, ...over });
      j.source.kind = "greenhouse";
      j.source.externalId = `${PREFIX}${id}:x`;
      return j;
    };
    const batch = [
      atsJob("stop1", { companyRaw: "Empresa Ficticia 8", jdText: JD_B + " Uno." }),
      atsJob("stop2", { companyRaw: "Empresa Ficticia 9", jdText: JD_C + " Dos." }),
      atsJob("stop3", { companyRaw: "Empresa Ficticia 10", jdText: JD_A + " Tres." }),
    ];
    let calls = 0;
    const out = await upsertPoolJobs(batch, {
      db: conn.db,
      logger,
      now: () => T1,
      taxonomy,
      shouldStop: () => calls++ >= 1,
    });
    expect(out).toMatchObject({ received: 3, inserted: 1, stopped: true });
    const rows = await conn.db
      .select({ id: s.publicJobs.externalId })
      .from(s.publicJobs)
      .where(like(s.publicJobs.externalId, `${PREFIX}stop%`));
    expect(rows.map((r) => r.id)).toEqual([`${PREFIX}stop1:x`]);
    // Sin corte, stopped es false
    const full = await upsertPoolJobs([batch[0]!], {
      db: conn.db,
      logger,
      now: () => T1,
      taxonomy,
    });
    expect(full.stopped).toBe(false);
  });

  it("dos llamadas concurrentes con el mismo aviso dejan una fila y un crudo", async () => {
    const raw = rawJob({
      id: "race",
      companyRaw: "Empresa Ficticia 11",
      jdText: JD_B + " Carrera.",
    });
    const blobsBefore = await poolBlobCount();
    const [x, y] = await Promise.all([
      upsertPoolJobs([raw], { db: conn.db, logger, now: () => T1, taxonomy }),
      upsertPoolJobs([raw], { db: conn.db, logger, now: () => T1, taxonomy }),
    ]);
    expect(x.errors + y.errors).toBe(0);
    expect(x.inserted + y.inserted).toBe(1);
    expect(x.unchanged + y.unchanged).toBe(1);
    const rows = await conn.db
      .select({ id: s.publicJobs.id })
      .from(s.publicJobs)
      .where(eq(s.publicJobs.externalId, `${PREFIX}race`));
    expect(rows).toHaveLength(1);
    expect(await poolBlobCount()).toBe(blobsBefore + 1);
  });
});

describe("upsertPoolJobs por lotes", () => {
  const distinct = (tag: string, i: number, over: Partial<RawJob> = {}) =>
    rawJob({
      id: `${tag}${i}`,
      companyRaw: `Empresa Lote ${tag} ${i}`,
      jdText: `${JD_A} Variante ${tag} ${i}.`,
      ...over,
    });

  it("150 nuevos del mismo board son dos lotes, con skills y crudos", async () => {
    const batch = Array.from({ length: 150 }, (_, i) => distinct("big", i));
    const blobsBefore = await poolBlobCount();
    let stopChecks = 0;
    const out = await upsertPoolJobs(batch, {
      db: conn.db,
      logger,
      now: () => T1,
      taxonomy,
      shouldStop: () => {
        stopChecks++;
        return false;
      },
    });
    expect(out).toMatchObject({ received: 150, inserted: 150, copies: 0, errors: 0 });
    expect(stopChecks).toBe(2);
    const rows = await conn.db
      .select({ id: s.publicJobs.id })
      .from(s.publicJobs)
      .where(like(s.publicJobs.externalId, `${PREFIX}big%`));
    expect(rows).toHaveLength(150);
    const [withSkills] = await conn.db
      .select({ n: sql<number>`count(distinct ${s.publicJobSkills.publicJobId})::int` })
      .from(s.publicJobSkills)
      .where(
        inArray(
          s.publicJobSkills.publicJobId,
          rows.map((r) => r.id),
        ),
      );
    expect(withSkills!.n).toBe(150);
    expect(await poolBlobCount()).toBe(blobsBefore + 150);
  });

  it("dos avisos con el mismo texto en un lote quedan como raíz y copia", async () => {
    const jd = `${JD_C} Gemelos del lote.`;
    const first = rawJob({ id: "twin1", companyRaw: "Empresa Lote Gemela", jdText: jd });
    const second = rawJob({ id: "twin2", companyRaw: "Empresa Lote Gemela", jdText: jd });
    const out = await upsertPoolJobs([first, second], {
      db: conn.db,
      logger,
      now: () => T1,
      taxonomy,
    });
    expect(out).toMatchObject({ inserted: 1, copies: 1, errors: 0 });
    const root = await row("twin1");
    const copy = await row("twin2");
    expect(root.dedupOfId).toBeNull();
    expect(copy.dedupOfId).toBe(root.id);
    expect(copy.jdText).toBe(jd);
  });

  it("un aviso que rompe la transacción: se reintenta uno por uno y solo el malo es error", async () => {
    const blobsBefore = await poolBlobCount();
    const batch = [
      distinct("rt", 1),
      distinct("rt", 2, { modality: "inexistente" as never }),
      distinct("rt", 3),
    ];
    const out = await upsertPoolJobs(batch, { db: conn.db, logger, now: () => T1, taxonomy });
    expect(out).toMatchObject({ inserted: 2, errors: 1, copies: 0 });
    expect(await poolBlobCount()).toBe(blobsBefore + 2);
    const rows = await conn.db
      .select({ id: s.publicJobs.externalId })
      .from(s.publicJobs)
      .where(like(s.publicJobs.externalId, `${PREFIX}rt%`));
    expect(rows.map((r) => r.id).sort()).toEqual([`${PREFIX}rt1`, `${PREFIX}rt3`]);
  });

  it("un lote que falla corta el reintento si shouldStop se vuelve true", async () => {
    const batch = [
      distinct("rs", 1),
      distinct("rs", 2, { modality: "inexistente" as never }),
      distinct("rs", 3),
    ];
    let calls = 0;
    const out = await upsertPoolJobs(batch, {
      db: conn.db,
      logger,
      now: () => T1,
      taxonomy,
      // 0: antes del lote; 1: primer aviso del reintento; 2: segundo aviso, ya corta
      shouldStop: () => calls++ >= 2,
    });
    expect(out).toMatchObject({ received: 3, inserted: 1, errors: 0, stopped: true });
    const rows = await conn.db
      .select({ id: s.publicJobs.externalId })
      .from(s.publicJobs)
      .where(like(s.publicJobs.externalId, `${PREFIX}rs%`));
    expect(rows.map((r) => r.id)).toEqual([`${PREFIX}rs1`]);
  });

  it("mezcla de nuevos, sin cambios y cambiados: cada uno en su contador", async () => {
    const same = distinct("mix", 1);
    const toChange = distinct("mix", 2);
    await upsertPoolJobs([same, toChange], { db: conn.db, logger, now: () => T0, taxonomy });
    const out = await upsertPoolJobs(
      [
        same,
        { ...toChange, salaryMinUsd: 1000, salaryMaxUsd: 1500, salaryPeriod: "mensual" },
        distinct("mix", 3),
      ],
      { db: conn.db, logger, now: () => T1, taxonomy },
    );
    expect(out).toMatchObject({ inserted: 1, updated: 1, unchanged: 1, copies: 0, errors: 0 });
    expect((await row("mix1")).lastSeenAt).toEqual(T1);
    expect((await row("mix2")).salaryMinUsd).toBe(1000);
    expect((await row("mix3")).firstSeenAt).toEqual(T1);
  });

  it("timeLeftMs que no alcanza para el segundo lote corta y cuenta solo el primero", async () => {
    const batch = Array.from({ length: 150 }, (_, i) => distinct("tl", i));
    let ticks = 0;
    let calls = 0;
    const out = await upsertPoolJobs(batch, {
      db: conn.db,
      logger,
      now: () => T1,
      taxonomy,
      // 1000 ms por lote de 100 avisos: 10 ms por aviso medido
      clock: () => (ticks++ ? 1000 : 0),
      timeLeftMs: () => (calls++ === 0 ? 10_000 : 100),
    });
    expect(out).toMatchObject({ received: 150, inserted: 100, stopped: true, errors: 0 });
    const rows = await conn.db
      .select({ id: s.publicJobs.id })
      .from(s.publicJobs)
      .where(like(s.publicJobs.externalId, `${PREFIX}tl%`));
    expect(rows).toHaveLength(100);
  });
});
