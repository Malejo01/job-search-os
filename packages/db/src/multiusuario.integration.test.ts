import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "./migrate";
import { USER_TABLES } from "./user-tables";

/**
 * JS-098 · Auditoría multiusuario, tests de dos usuarios. Por el camino real: la app se conecta
 * como jobsearch_app (NOBYPASSRLS) y fija app.user_id = A. Con filas de B en todas las tablas:
 * SELECT, UPDATE, DELETE e INSERT ajenos no tocan nada. Se arma desde USER_TABLES, así que una
 * tabla nueva sin policy (o sin fila de ejemplo) rompe el test. Datos inventados.
 */
const A = "a8000000-0000-4000-8000-000000000001";
const B = "b8000000-0000-4000-8000-000000000002";
/** Tercero: crea la invitación que canjea B (así A no es el invitador y no la ve por diseño). */
const C = "c8000000-0000-4000-8000-000000000003";
const APP_PASSWORD = "jobsearch_app_test";
const EMAIL_B = "b@dos.test";

/** Tablas de usuario que no están en USER_TABLES: no tienen user_id, cuelgan de jobs o son users. */
const EXTRA_TABLES = [
  { table: "users", column: "id" },
  { table: "job_sources", column: "job_id" },
  { table: "job_skills", column: "job_id" },
] as const;

/** Catálogos compartidos sin dueño: lectura abierta a propósito, sin escritura para la app. */
const CATALOG_TABLES = ["companies", "skills", "model_routing", "learning_resources"];

/**
 * JS-103, ver #54 (trae sus propios tests de lectura cruzada). Se excluyen solo del chequeo de
 * SELECT. learning_resources es catálogo compartido.
 */
const SELECT_OPEN = new Set(["learning_resources"]);
/**
 * La exclusión de users / password_reset_tokens es condicional: se calcula en beforeAll mirando
 * pg_policies. Si la policy de lectura de la app ya está cerrada (qual distinto de `true`), tras el
 * merge de #54, la tabla entra sola a los chequeos de SELECT.
 */
const OPEN_READ_CANDIDATES = ["users", "password_reset_tokens"];

type Target = { table: string; column: string };

/** Pares (tabla, columna dueña) sin repetir: USER_TABLES lista algunas tablas dos veces */
const TARGETS: Target[] = [
  ...new Map(
    [...USER_TABLES, ...EXTRA_TABLES].map((e) => [`${e.table}.${e.column}`, e] as const),
  ).values(),
].map((e) => ({ table: e.table, column: e.column }));

/** Tablas que las funciones SECURITY DEFINER pueden tocar: se compara la huella de B antes y después */
const FN_TABLES: Target[] = [
  { table: "users", column: "id" },
  { table: "invitations", column: "created_by_user_id" },
  { table: "invitations", column: "used_by_user_id" },
  { table: "profiles", column: "user_id" },
  { table: "password_reset_tokens", column: "user_id" },
];
const key = (t: Target) => `${t.table}.${t.column}`;
const snapshotB: Record<string, string> = {};

let container: StartedPostgreSqlContainer | null = null;
let owner: Sql;
let app: Sql;
let jobB: string;

/** Una transacción como la app: app.user_id fijado (o sin fijar con null) */
async function asUser<T>(userId: string | null, fn: (tx: postgres.TransactionSql) => Promise<T>) {
  return (await app.begin(async (tx) => {
    if (userId) await tx.unsafe(`SET LOCAL app.user_id = '${userId}'`);
    return fn(tx);
  })) as T;
}

/** Huella de las filas de un usuario en una tabla, como dueño: cuenta + md5 del contenido */
async function fingerprint(t: Target, id: string): Promise<string> {
  const [r] = await owner.unsafe<{ fp: string }[]>(
    `select count(*)::text || ':' || coalesce(md5(string_agg(to_jsonb(x)::text, ',' order by to_jsonb(x)::text)), '') as fp
       from "${t.table}" x where "${t.column}" = $1`,
    [id],
  );
  return r!.fp;
}

async function seed(id: string, tag: string): Promise<{ jobId: string }> {
  await owner`insert into users (id, email, password_hash) values (${id}, ${tag + "@dos.test"}, 'x')`;
  await owner`insert into password_reset_tokens (user_id, token_hash, expires_at)
               values (${id}, ${"tok-" + tag}, now() + interval '1 hour')`;
  await owner`insert into profiles (user_id, display_name, location_country, inbound_address)
               values (${id}, ${"Persona " + tag}, 'AR', ${"u_" + tag + "@ingest.test"})`;
  await owner`insert into evaluation_criteria (user_id, version, active, rules)
               values (${id}, 1, true, '{}'::jsonb)`;
  const [job] = await owner<{ id: string }[]>`
    insert into jobs (user_id, company_raw, title, title_normalized)
    values (${id}, 'Empresa de Prueba', ${"Oferta Ficticia " + tag}, ${"oferta ficticia " + tag}) returning id`;
  await owner`insert into job_sources (job_id, kind) values (${job!.id}, 'manual')`;
  await owner`insert into evaluations (job_id, user_id, criteria_version, prompt_version, model,
                had_full_jd, score, location_ok, modality, discipline, match_fuerte, gaps,
                bloqueadores_duros, senales_positivas, veredicto, accion)
              values (${job!.id}, ${id}, 1, 'p@v1', 'm', true, 7, 'ok', 'remoto', 'ai_engineer',
                '{}', '{}', '{}', '{}', 'ok', 'aplicar')`;
  await owner`insert into applications (job_id, user_id) values (${job!.id}, ${id})`;
  await owner`insert into application_answers (user_id, job_id, position, question, answer)
               values (${id}, ${job!.id}, 0, 'Pregunta ficticia?', 'Respuesta ficticia')`;
  await owner`insert into answer_bank (user_id, question, question_normalized, answer, lang, source_job_id)
               values (${id}, 'Pregunta ficticia?', 'pregunta ficticia', 'Respuesta ficticia', 'es', ${job!.id})`;
  await owner`insert into candidate_facts (user_id, key, project, claim, source)
               values (${id}, 'k1', 'Proyecto de Prueba', 'Afirmación ficticia', 'https://example.test')`;
  await owner`insert into application_settings (user_id, availability) values (${id}, 'inmediata')`;
  await owner`insert into contacts (user_id, name) values (${id}, 'Contacto de Prueba')`;
  await owner`insert into talent_platforms (user_id, name, status) values (${id}, 'Plataforma de Prueba', 'pendiente')`;
  const [skill] = await owner<{ id: string }[]>`
    insert into skills (slug, name, category) values (${"skill-dos-" + tag}, 'Skill de Prueba', 'otra') returning id`;
  await owner`insert into job_skills (job_id, skill_id, is_must)
               values (${job!.id}, ${skill!.id}, true)`;
  await owner`insert into skill_levels (user_id, skill_id, level, confidence, state)
               values (${id}, ${skill!.id}, 2, 0.5, 'parcial')`;
  await owner`insert into skill_evidence (user_id, skill_id, type, description)
               values (${id}, ${skill!.id}, 'otra', 'evidencia ficticia')`;
  await owner`insert into skill_interviews (user_id, skill_id, question) values (${id}, ${skill!.id}, 'Pregunta?')`;
  await owner`insert into market_snapshots (user_id, week_start, skill_id, mentions, must_mentions, weighted_demand)
               values (${id}, '2026-01-05', ${skill!.id}, 1, 1, 1)`;
  const [resource] = await owner<{ id: string }[]>`
    insert into learning_resources (skill_id, title, provider, url, target_level, created_by_user_id)
    values (${skill!.id}, ${"Curso Ficticio " + tag}, 'Proveedor de Prueba', 'https://example.test/c', 2, ${id}) returning id`;
  await owner`insert into learning_resources (skill_id, title, provider, url, target_level, approved, created_by_user_id)
    values (${skill!.id}, ${"Curso Aprobado " + tag}, 'Proveedor de Prueba', 'https://example.test/d', 2, true, ${id})`;
  await owner`insert into learning_plan_items (user_id, skill_id, resource_id, priority)
               values (${id}, ${skill!.id}, ${resource!.id}, 1)`;
  await owner`insert into llm_calls (user_id, task, model, ok) values (${id}, 'evaluate_job', 'm', true)`;
  await owner`insert into job_queue (queue, user_id, payload) values ('evaluate_job', ${id}, '{}'::jsonb)`;
  await owner`insert into raw_blobs (user_id, kind, content_type, body, bytes)
               values (${id}, 'inbound_email', 'message/rfc822', 'cuerpo ficticio', 14)`;
  await owner`insert into inbound_emails (user_id, from_address, raw_ref)
               values (${id}, 'alertas@example.test', 'pg:x')`;
  await owner`insert into inbound_rejections (user_id, window_start) values (${id}, now())`;
  await owner`insert into inbound_sender_domains (user_id, domain, verdict)
               values (${id}, 'example.test', 'empleo')`;
  await owner`insert into invitations (code_hash, created_by_user_id) values (${"hash-creada-" + tag}, ${id})`;
  return { jobId: job!.id };
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
  owner = postgres(ownerUrl, { max: 1, prepare: false });
  await owner.unsafe(`ALTER ROLE jobsearch_app WITH PASSWORD '${APP_PASSWORD}'`);
  const u = new URL(ownerUrl);
  u.username = "jobsearch_app";
  u.password = APP_PASSWORD;
  app = postgres(u.toString(), { max: 4, prepare: false });

  for (const table of OPEN_READ_CANDIDATES) {
    const open = await owner<{ qual: string | null }[]>`
      select qual from pg_policies
      where schemaname = 'public' and tablename = ${table} and cmd in ('SELECT', 'ALL')
        and roles = '{public}' and qual = 'true'`;
    if (open.length > 0) SELECT_OPEN.add(table);
  }

  await seed(A, "a");
  jobB = (await seed(B, "b")).jobId;
  await owner`insert into users (id, email, password_hash) values (${C}, 'c@dos.test', 'x')`;
  // Invitación creada por un tercero y canjeada por B (cubre invitations.used_by_user_id)
  await owner`insert into invitations (code_hash, created_by_user_id, email, used_at, used_by_user_id)
               values ('hash-canjeada-por-b', ${C}, ${EMAIL_B}, now(), ${B})`;
  // Invitación de B sin canjear, para los casos de las funciones
  await owner`insert into invitations (code_hash, created_by_user_id) values ('hash-libre-de-b', ${B})`;
  for (const t of FN_TABLES) snapshotB[key(t)] = await fingerprint(t, B);
}, 180_000);

afterAll(async () => {
  if (owner) {
    // Limpieza por si la base es compartida (CI): lo de A, B y C como dueño, hijos antes que padres
    const ids = [A, B, C];
    for (const e of USER_TABLES) {
      await owner`delete from ${owner(e.table)} where ${owner(e.column)} in ${owner(ids)}`;
    }
    await owner`delete from users where id in ${owner(ids)}`;
    await owner`delete from skills where slug like 'skill-dos-%'`;
  }
  await app?.end();
  await owner?.end();
  await container?.stop();
});

describe("cobertura: ninguna tabla queda afuera", () => {
  it("toda tabla de public es de usuario (USER_TABLES / extras) o un catálogo conocido", async () => {
    const tables = await owner<{ relname: string }[]>`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
        and c.relname not in ('__drizzle_migrations')`;
    const known = new Set([
      ...USER_TABLES.map((e) => e.table),
      ...EXTRA_TABLES.map((e) => e.table),
      ...CATALOG_TABLES,
    ]);
    const missing = tables.map((t) => t.relname).filter((t) => !known.has(t));
    // Si falla: tabla nueva. Sumarla a USER_TABLES (con su RLS) o a CATALOG_TABLES si es compartida.
    expect(missing).toEqual([]);
  });

  it("toda tabla con user_id / created_by_user_id / used_by_user_id tiene RLS forzado y al menos una policy", async () => {
    const rows = await owner<{ relname: string; rls: boolean; force: boolean; policies: number }[]>`
      select c.relname, c.relrowsecurity as rls, c.relforcerowsecurity as force,
             (select count(*)::int from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname) as policies
      from pg_class c join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
      where c.relkind = 'r'
        and exists (select 1 from information_schema.columns col
                    where col.table_schema = 'public' and col.table_name = c.relname
                      and col.column_name in ('user_id', 'created_by_user_id', 'used_by_user_id'))`;
    const tablesOfList = new Set(USER_TABLES.map((e) => e.table));
    for (const t of tablesOfList)
      expect(
        rows.map((r) => r.relname),
        t,
      ).toContain(t);
    // learning_resources es catálogo compartido: RLS activo sin FORCE (el dueño/seed lo escribe)
    expect(
      rows
        .filter(
          (r) => !r.rls || (!r.force && r.relname !== "learning_resources") || r.policies === 0,
        )
        .map((r) => r.relname),
    ).toEqual([]);
  });

  it("job_sources y job_skills (sin user_id) también tienen RLS forzado con policy", async () => {
    const rows = await owner<{ relname: string; rls: boolean; force: boolean }[]>`
      select relname, relrowsecurity as rls, relforcerowsecurity as force from pg_class
      where relname in ('job_sources', 'job_skills') and relkind = 'r' order by relname`;
    expect(rows).toEqual([
      { relname: "job_skills", rls: true, force: true },
      { relname: "job_sources", rls: true, force: true },
    ]);
  });

  it("los catálogos (companies, skills, model_routing) no tienen columna de dueño: borrar una cuenta no los toca", async () => {
    const rows = await owner<{ table_name: string }[]>`
      select table_name from information_schema.columns
      where table_schema = 'public'
        and table_name in ('companies', 'skills', 'model_routing')
        and column_name in ('user_id', 'created_by_user_id', 'used_by_user_id')`;
    expect(rows).toEqual([]);
    // Y ninguno está en la lista de borrado de cuenta
    const inList = USER_TABLES.map((e) => e.table).filter((t) =>
      ["companies", "skills", "model_routing"].includes(t),
    );
    expect(inList).toEqual([]);
  });

  it("el rol de la app no es dueño ni saltea RLS", async () => {
    const [role] =
      await owner`select rolbypassrls, rolsuper from pg_roles where rolname = 'jobsearch_app'`;
    expect(role).toEqual({ rolbypassrls: false, rolsuper: false });
  });

  it("cada tabla de la lista tiene filas de A y de B (el test mide algo)", async () => {
    const empty: string[] = [];
    for (const t of TARGETS) {
      for (const who of [A, B]) {
        const value =
          t.column === "job_id"
            ? (await owner<{ id: string }[]>`select id from jobs where user_id = ${who}`)[0]!.id
            : who;
        const fp = await fingerprint(t, value);
        // invitations.used_by_user_id: solo B canjeó una (la de A no existe por diseño)
        if (fp.startsWith("0:") && !(t.column === "used_by_user_id" && who === A)) {
          empty.push(`${t.table}.${t.column}@${who === A ? "A" : "B"}`);
        }
      }
    }
    expect(empty).toEqual([]);
  });
});

describe("con contexto de A, las filas de B no se leen, no se cambian, no se borran, no se insertan", () => {
  for (const t of TARGETS) {
    describe(`${t.table}.${t.column}`, () => {
      // Para job_sources / job_skills el "dueño" es la oferta de B
      const owned = () => (t.column === "job_id" ? jobB : B);

      it("SELECT de las filas de B devuelve 0", async () => {
        if (SELECT_OPEN.has(t.table)) {
          // users / password_reset_tokens: JS-103 y PR #54 (ver arriba). learning_resources: catálogo.
          return;
        }
        const rows = await asUser(A, (tx) =>
          tx.unsafe(`select 1 from "${t.table}" where "${t.column}" = $1`, [owned()]),
        );
        expect(rows).toHaveLength(0);
      });

      it("UPDATE de las filas de B afecta 0", async () => {
        const before = await fingerprint(t, owned());
        const res = await asUser(A, (tx) =>
          tx.unsafe(
            `update "${t.table}" set "${t.column}" = "${t.column}" where "${t.column}" = $1`,
            [owned()],
          ),
        );
        expect(res.count).toBe(0);
        expect(await fingerprint(t, owned())).toBe(before);
      });

      it("DELETE de las filas de B afecta 0", async () => {
        const before = await fingerprint(t, owned());
        const res = await asUser(A, (tx) =>
          tx.unsafe(`delete from "${t.table}" where "${t.column}" = $1`, [owned()]),
        );
        expect(res.count).toBe(0);
        expect(await fingerprint(t, owned())).toBe(before);
      });

      it("INSERT de una fila de B (copia de la suya) falla por RLS", async () => {
        const [row] = await owner.unsafe<{ j: string }[]>(
          `select to_jsonb(x)::text as j from "${t.table}" x where "${t.column}" = $1 limit 1`,
          [owned()],
        );
        expect(row, "B no tiene fila de ejemplo").toBeDefined();
        await expect(
          asUser(A, (tx) =>
            tx.unsafe(
              `insert into "${t.table}" select * from jsonb_populate_record(null::"${t.table}", $1::text::jsonb)`,
              [row!.j],
            ),
          ),
        ).rejects.toThrow(/row-level security/);
      });
    });
  }

  it("B tiene todo intacto después de los ataques", async () => {
    for (const t of TARGETS) {
      const [r] = await owner.unsafe<{ n: number }[]>(
        `select count(*)::int as n from "${t.table}" where "${t.column}" = $1`,
        [t.column === "job_id" ? jobB : B],
      );
      const n = r!.n;
      expect(n, `${t.table}.${t.column}`).toBeGreaterThan(0);
    }
  });

  it("A sí ve lo suyo (control de lectura: el aislamiento no es un 'no ve nada' general)", async () => {
    for (const t of TARGETS) {
      if (t.table === "learning_resources" || t.column === "used_by_user_id") continue;
      const jobA = (await owner<{ id: string }[]>`select id from jobs where user_id = ${A}`)[0]!.id;
      const mine = t.column === "job_id" ? jobA : A;
      const rows = await asUser(A, (tx) =>
        tx.unsafe(`select 1 from "${t.table}" where "${t.column}" = $1`, [mine]),
      );
      expect(rows.length, `${t.table}.${t.column}`).toBeGreaterThan(0);
    }
  });
});

describe("control negativo", () => {
  it("sin RLS en contacts, A SÍ lee y borra lo de B (las consultas del test miden algo)", async () => {
    const t: Target = { table: "contacts", column: "user_id" };
    await owner.unsafe(`alter table contacts no force row level security`);
    await owner.unsafe(`alter table contacts disable row level security`);
    try {
      const rows = await asUser(A, (tx) =>
        tx.unsafe(`select 1 from "${t.table}" where "${t.column}" = $1`, [B]),
      );
      expect(rows.length).toBeGreaterThan(0);
      const upd = await asUser(A, (tx) =>
        tx.unsafe(`update "${t.table}" set name = name where "${t.column}" = $1`, [B]),
      );
      expect(upd.count).toBeGreaterThan(0);
    } finally {
      await owner.unsafe(`alter table contacts enable row level security`);
      await owner.unsafe(`alter table contacts force row level security`);
    }
    const again = await asUser(A, (tx) =>
      tx.unsafe(`select 1 from contacts where user_id = $1`, [B]),
    );
    expect(again).toHaveLength(0);
  });
});

describe("sin contexto (app.user_id vacío) las tablas dan 0 filas", () => {
  for (const t of TARGETS) {
    it(`${t.table}`, async () => {
      if (SELECT_OPEN.has(t.table)) return; // misma excepción que arriba (JS-103, #54)
      const rows = await asUser(null, (tx) => tx.unsafe(`select 1 from "${t.table}"`));
      expect(rows).toHaveLength(0);
    });
  }

  it("tampoco inserta ni modifica nada (jobs)", async () => {
    await expect(
      asUser(
        null,
        (tx) => tx`insert into jobs (user_id, company_raw, title, title_normalized)
                   values (${B}, 'Empresa de Prueba', 'x', 'x')`,
      ),
    ).rejects.toThrow(/row-level security/);
    const res = await asUser(null, (tx) => tx`update jobs set title = 'x'`);
    expect(res.count).toBe(0);
  });

  it("app.user_id con basura no abre nada: falla o 0 filas, nunca todas", async () => {
    for (const junk of ["", "no-es-un-uuid", "' or true --"]) {
      let n: number;
      try {
        n = await app.begin(async (tx) => {
          await tx`select set_config('app.user_id', ${junk}, true)`;
          return (await tx`select 1 from jobs`).length;
        });
      } catch {
        n = 0; // un error de cast también es cerrado
      }
      expect(n, junk).toBe(0);
    }
  });
});

describe("funciones SECURITY DEFINER con contexto de A y argumentos de B", () => {
  type FnRow = { proname: string; args: string; search_path: string | null; public_exec: boolean };

  async function definers(): Promise<FnRow[]> {
    return owner<FnRow[]>`
      select p.proname, pg_get_function_identity_arguments(p.oid) as args,
             (select c from unnest(p.proconfig) c where c like 'search_path=%') as search_path,
             has_function_privilege('public', p.oid, 'EXECUTE') as public_exec
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where p.prosecdef and n.nspname not in ('pg_catalog', 'information_schema')
      order by p.proname`;
  }

  /** Cada función tiene su caso; una nueva sin caso rompe el test para obligar a auditarla. */
  const CASES: Record<string, () => Promise<void>> = {
    // Raise: solo se desvincula la cuenta propia. La invitación de B queda como estaba.
    release_invitations: async () => {
      const before = await fingerprint({ table: "invitations", column: "used_by_user_id" }, B);
      await expect(asUser(A, (tx) => tx`select release_invitations(${B}::uuid)`)).rejects.toThrow(
        /solo se puede desvincular la cuenta propia/,
      );
      expect(await fingerprint({ table: "invitations", column: "used_by_user_id" }, B)).toBe(
        before,
      );
      await expect(asUser(A, (tx) => tx`select release_invitations(null)`)).rejects.toThrow();
    },
    // Sin EXECUTE para el rol de la app desde JS-113: llamarla falla y no toca la invitación de B.
    register_with_invitation: async () => {
      const before = await fingerprint({ table: "invitations", column: "used_by_user_id" }, B);
      await expect(
        asUser(
          A,
          (tx) => tx`select register_with_invitation(
          'hash-canjeada-por-b', ${EMAIL_B}, 'x', 'Intruso', 'ingest.test') as id`,
        ),
      ).rejects.toThrow(/permission denied/);
      expect(await fingerprint({ table: "invitations", column: "used_by_user_id" }, B)).toBe(
        before,
      );
    },
    register_with_invitation_v3: async () => {
      const before = await fingerprint({ table: "invitations", column: "used_by_user_id" }, B);
      const [r] = await asUser(
        A,
        (tx) => tx<{ id: string | null }[]>`select register_with_invitation_v3(
          'hash-canjeada-por-b', ${EMAIL_B}, 'x', 'Intruso', 'ingest.test', '2026-10-07',
          'abcdefghijklmnopqrst') as id`,
      );
      expect(r!.id).toBeNull();
      expect(await fingerprint({ table: "invitations", column: "used_by_user_id" }, B)).toBe(
        before,
      );
      expect(await owner`select 1 from users where name = 'Intruso'`).toHaveLength(0);
    },
    register_with_invitation_v2: async () => {
      const before = await fingerprint({ table: "invitations", column: "used_by_user_id" }, B);
      const [r] = await asUser(
        A,
        (tx) => tx<{ id: string | null }[]>`select register_with_invitation_v2(
          'hash-canjeada-por-b', ${EMAIL_B}, 'x', 'Intruso', 'ingest.test', '2026-10-07') as id`,
      );
      expect(r!.id).toBeNull();
      expect(await fingerprint({ table: "invitations", column: "used_by_user_id" }, B)).toBe(
        before,
      );
      expect(await owner`select 1 from users where name = 'Intruso'`).toHaveLength(0);
    },
    // Solo responde sí/no a quien ya conoce el hash del código (el secreto es el hash)
    invitation_is_redeemable: async () => {
      const [usada] = await asUser(
        A,
        (tx) =>
          tx<
            { ok: boolean }[]
          >`select invitation_is_redeemable('hash-canjeada-por-b', ${EMAIL_B}) as ok`,
      );
      expect(usada!.ok).toBe(false);
      const [noExiste] = await asUser(
        A,
        (tx) =>
          tx<{ ok: boolean }[]>`select invitation_is_redeemable('no-existe', ${EMAIL_B}) as ok`,
      );
      expect(noExiste!.ok).toBe(false);
    },
    // Solo devuelve la fila de un token cuyo hash se conoce; uno inventado no devuelve nada
    check_reset_token: async () => {
      const none = await asUser(A, (tx) => tx`select * from check_reset_token('hash-inventado')`);
      expect(none).toHaveLength(0);
    },
    // Estas tres no devuelven más que existencia o conteo global, sin datos de B
    has_any_user: async () => {
      const [r] = await asUser(A, (tx) => tx<{ ok: boolean }[]>`select has_any_user() as ok`);
      expect(r!.ok).toBe(true);
    },
    sole_user_id: async () => {
      // Con 2+ usuarios es NULL: no entrega el id de nadie (con A y B hay al menos dos)
      const [r] = await asUser(A, (tx) => tx<{ id: string | null }[]>`select sole_user_id() as id`);
      expect(r!.id).toBeNull();
    },
    user_exists: async () => {
      const [r] = await asUser(
        A,
        (tx) =>
          tx<
            { ok: boolean }[]
          >`select user_exists(${"d8000000-0000-4000-8000-0000000000ff"}::uuid) as ok`,
      );
      expect(r!.ok).toBe(false);
    },
    // Lookup por email: acá solo un email inexistente.
    auth_user_by_email: async () => {
      expect(
        await asUser(A, (tx) => tx`select * from auth_user_by_email('nadie@dos.test')`),
      ).toHaveLength(0);
    },
    user_id_by_email: async () => {
      const [r] = await asUser(
        A,
        (tx) => tx<{ id: string | null }[]>`select user_id_by_email('nadie@dos.test') as id`,
      );
      expect(r!.id).toBeNull();
    },
  };

  it("toda función SECURITY DEFINER tiene un caso, search_path fijo y sin EXECUTE para PUBLIC", async () => {
    const fns = await definers();
    expect(fns.length).toBeGreaterThan(0);
    const sinCaso = fns.filter((f) => !(f.proname in CASES)).map((f) => `${f.proname}(${f.args})`);
    // Si falla: función nueva. Auditarla y agregar su caso en CASES.
    expect(sinCaso).toEqual([]);
    expect(fns.filter((f) => !f.search_path).map((f) => f.proname)).toEqual([]);
    expect(fns.filter((f) => f.public_exec).map((f) => f.proname)).toEqual([]);
  });

  it("las funciones corren como el dueño de las tablas, no como la app", async () => {
    const rows = await owner<{ proname: string; owner: string }[]>`
      select p.proname, pg_get_userbyid(p.proowner) as owner from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where p.prosecdef and n.nspname = 'public'`;
    expect(rows.filter((r) => r.owner === "jobsearch_app").map((r) => r.proname)).toEqual([]);
  });

  for (const name of Object.keys(CASES)) {
    it(`${name}: con contexto de A no devuelve ni escribe datos de B`, async () => {
      await CASES[name]!();
    });
  }

  it("ninguna función de public (definer o no) deja a A escribir filas de B (estado de B intacto)", async () => {
    // Las pruebas de arriba ya corrieron; la huella de B en las tablas que tocan las funciones no cambió
    for (const t of FN_TABLES) {
      expect(await fingerprint(t, B), `${t.table}.${t.column}`).toBe(snapshotB[key(t)]);
    }
    expect(await owner`select 1 from users where name = 'Intruso'`).toHaveLength(0);
  });
});

describe("funciones de cuenta: comportamiento por diseño (se fija para que un cambio sea visible)", () => {
  it("auth_user_by_email resuelve por email sin depender del contexto", async () => {
    const rows = await asUser(
      A,
      (tx) =>
        tx<{ id: string; password_hash: string }[]>`select * from auth_user_by_email(${EMAIL_B})`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(B);
    expect(rows[0]!.password_hash).toBe("x");
  });

  it("user_id_by_email y user_exists resuelven por email o id", async () => {
    const [byEmail] = await asUser(
      A,
      (tx) => tx<{ id: string | null }[]>`select user_id_by_email(${EMAIL_B}) as id`,
    );
    expect(byEmail!.id).toBe(B);
    const [exists] = await asUser(
      A,
      (tx) => tx<{ ok: boolean }[]>`select user_exists(${B}::uuid) as ok`,
    );
    expect(exists!.ok).toBe(true);
  });

  it("check_reset_token resuelve por hash del token", async () => {
    const rows = await asUser(
      A,
      (tx) => tx<{ user_id: string }[]>`select user_id from check_reset_token('tok-b')`,
    );
    expect(rows.map((r) => r.user_id)).toEqual([B]);
  });

  it("invitation_is_redeemable responde por hash de código", async () => {
    const [r] = await asUser(
      A,
      (tx) =>
        tx<
          { ok: boolean }[]
        >`select invitation_is_redeemable('hash-libre-de-b', 'cualquiera@dos.test') as ok`,
    );
    expect(r!.ok).toBe(true);
  });
});

describe("sentencias de la app con el id de una fila de B y contexto de A", () => {
  /** Id de la primera fila de B en la tabla (como dueño) */
  async function idOfB(table: string, column = "user_id"): Promise<string> {
    const [r] = await owner.unsafe<{ id: string }[]>(
      `select id from "${table}" where "${column}" = $1 limit 1`,
      [B],
    );
    return r!.id;
  }

  it("setOutcome, setPlanStatus, humanScore, revokeInvitation y deleteInbound afectan 0 filas", async () => {
    const appId = await idOfB("applications");
    const itemId = await idOfB("learning_plan_items");
    const evalId = await idOfB("evaluations");
    const invId = await idOfB("invitations", "created_by_user_id");
    const emailId = await idOfB("inbound_emails");
    const before = {
      a: await fingerprint({ table: "applications", column: "user_id" }, B),
      p: await fingerprint({ table: "learning_plan_items", column: "user_id" }, B),
      e: await fingerprint({ table: "evaluations", column: "user_id" }, B),
      i: await fingerprint({ table: "invitations", column: "created_by_user_id" }, B),
      m: await fingerprint({ table: "inbound_emails", column: "user_id" }, B),
    };
    const counts = await asUser(A, async (tx) => [
      (await tx`update applications set outcome = 'rechazo_humano' where id = ${appId}`).count,
      (await tx`update learning_plan_items set status = 'hecho' where id = ${itemId}`).count,
      (await tx`update evaluations set human_score = 1 where id = ${evalId}`).count,
      (await tx`delete from invitations where id = ${invId}`).count,
      (await tx`update inbound_emails set dismissed_at = now() where id = ${emailId}`).count,
      (await tx`delete from inbound_emails where id = ${emailId}`).count,
    ]);
    expect(counts).toEqual([0, 0, 0, 0, 0, 0]);
    expect({
      a: await fingerprint({ table: "applications", column: "user_id" }, B),
      p: await fingerprint({ table: "learning_plan_items", column: "user_id" }, B),
      e: await fingerprint({ table: "evaluations", column: "user_id" }, B),
      i: await fingerprint({ table: "invitations", column: "created_by_user_id" }, B),
      m: await fingerprint({ table: "inbound_emails", column: "user_id" }, B),
    }).toEqual(before);
  });

  // JS-114: el job_id de una evaluación o postulación tiene que ser una oferta propia.
  const insertFor = (tx: Sql, table: string, jobId: string) =>
    table === "applications"
      ? tx`insert into applications (job_id, user_id) values (${jobId}, ${A})`
      : tx`insert into evaluations (job_id, user_id, criteria_version, prompt_version, model,
                had_full_jd, score, location_ok, modality, discipline, match_fuerte, gaps,
                bloqueadores_duros, senales_positivas, veredicto, accion)
              values (${jobId}, ${A}, 1, 'p@v1', 'm', true, 7, 'ok', 'remoto', 'ai_engineer',
                '{}', '{}', '{}', '{}', 'ok', 'aplicar')`;
  const cleanup = (table: string, jobId: string) =>
    owner.unsafe(`delete from ${table} where user_id = $1 and job_id = $2`, [A, jobId]);

  for (const table of ["evaluations", "applications"]) {
    // Control: el insert está bien armado, así el test de abajo mide solo el rechazo.
    it(`control (JS-114, ${table}): la inserción con referencia propia funciona`, async () => {
      const [mine] = await owner<
        { id: string }[]
      >`select id from jobs where user_id = ${A} limit 1`;
      try {
        await asUser(A, (tx) => insertFor(tx as unknown as Sql, table, mine!.id));
        await insertFor(owner, table, jobB);
      } finally {
        await cleanup(table, mine!.id);
        await cleanup(table, jobB);
      }
    });

    it(`inserción con referencia a un registro ajeno es rechazada en ${table} (JS-114)`, async () => {
      let error: unknown = null;
      try {
        await asUser(A, (tx) => insertFor(tx as unknown as Sql, table, jobB));
      } catch (e) {
        error = e;
      } finally {
        await cleanup(table, jobB);
      }
      if (error) expect(String(error)).toMatch(/row-level security/);
      expect(error, "la inserción no fue rechazada").not.toBeNull();
    });
  }

  // El worker inserta con la conexión de servicio (dueño con BYPASSRLS, sin app.user_id): las
  // policies nuevas no lo alcanzan. Rol de prueba: BYPASSRLS, sin superusuario.
  it("la conexión de servicio (BYPASSRLS, sin contexto de usuario) sigue insertando (JS-114)", async () => {
    const [mine] = await owner<{ id: string }[]>`select id from jobs where user_id = ${A} limit 1`;
    await owner.unsafe(`
      DROP ROLE IF EXISTS jso_servicio_test;
      CREATE ROLE jso_servicio_test NOLOGIN NOSUPERUSER BYPASSRLS;
      GRANT USAGE ON SCHEMA public TO jso_servicio_test;
      GRANT SELECT ON jobs TO jso_servicio_test;
      GRANT SELECT, INSERT ON evaluations, applications TO jso_servicio_test;
    `);
    try {
      for (const table of ["evaluations", "applications"]) {
        try {
          await owner.begin(async (tx) => {
            await tx.unsafe("SET LOCAL ROLE jso_servicio_test");
            const r = await insertFor(tx as unknown as Sql, table, mine!.id);
            expect(r.count).toBe(1);
          });
        } finally {
          await cleanup(table, mine!.id);
        }
      }
    } finally {
      await owner.unsafe("DROP OWNED BY jso_servicio_test; DROP ROLE jso_servicio_test;");
    }
  });
});
