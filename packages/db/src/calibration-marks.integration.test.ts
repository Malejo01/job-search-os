import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "./migrate";

/**
 * Exportación de la calibración (R31-10, rls/0073) por el camino real: la app como jobsearch_app. Solo admins;
 * solo la evaluación nueva (v1.5+) y solo lo marcado; sin datos personales; el título y la empresa solo de
 * avisos del pool. Datos inventados.
 */
const APP_PASSWORD = "jobsearch_app_test";
const ADMIN = "e3100000-0000-4000-8000-0000000000d1";
const TESTER = "e3100000-0000-4000-8000-0000000000d2";
const COMUN = "e3100000-0000-4000-8000-0000000000d3";
const EXTERNAL_ID = "calibration-marks-test";
const EMAIL_TESTER = "tester-calibracion@ejemplo.test";

let container: StartedPostgreSqlContainer | null = null;
let owner: Sql;
let app: Sql;

async function asUser<T>(userId: string, fn: (tx: Sql) => Promise<T>): Promise<T> {
  return (await app.begin(async (tx) => {
    await tx`select set_config('app.user_id', ${userId}, true)`;
    return fn(tx as unknown as Sql);
  })) as T;
}

async function newEvaluation(
  userId: string,
  jobId: string,
  over: {
    prompt?: string;
    verdict?: string | null;
    note?: string | null;
    humanScore?: number | null;
  } = {},
) {
  await owner`insert into evaluations (job_id, user_id, criteria_version, prompt_version, model, had_full_jd, score,
      location_ok, modality, discipline, match_fuerte, gaps, bloqueadores_duros, senales_positivas, veredicto, accion,
      human_verdict, human_verdict_at, human_note, human_score)
    values (${jobId}, ${userId}, 1, ${over.prompt ?? "evaluate_job@v1.5.0"}, 'm', true, 7.5, 'ok', 'presencial',
      'abogacia', '{}', '{}', ${["Modalidad presencial"]}, '{}', 'ok', 'aplicar',
      ${over.verdict ?? null}, ${over.verdict ? new Date("2026-11-25T15:00:00Z") : null}, ${over.note ?? null},
      ${over.humanScore ?? null})`;
}

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
  owner = postgres(ownerUrl, { max: 6, prepare: false });
  await owner.unsafe(`ALTER ROLE jobsearch_app WITH PASSWORD '${APP_PASSWORD}'`);
  const u = new URL(ownerUrl);
  u.username = "jobsearch_app";
  u.password = APP_PASSWORD;
  app = postgres(u.toString(), { max: 4, prepare: false });
  for (const [id, email] of [
    [ADMIN, "admin-calibracion@ejemplo.test"],
    [TESTER, EMAIL_TESTER],
    [COMUN, "comun-calibracion@ejemplo.test"],
  ] as const) {
    await owner`insert into users (id, email, name) values (${id}, ${email}, 'Ficticio') on conflict (id) do nothing`;
  }
  await owner`insert into app_admins (user_id) values (${ADMIN}) on conflict do nothing`;

  const [pub] = await owner<{ id: string }[]>`
    insert into public_jobs (source_kind, external_id, source_name, source_url, title, title_normalized,
      company_raw, company_normalized, jd_hash, first_seen_at, last_seen_at)
    values ('remoteok', ${EXTERNAL_ID}, 'Remote OK', 'https://example.com/jobs/1', 'Abogado/a societario',
      'abogado societario', 'Empresa A', 'empresa a', ${"c4".repeat(32)}, now(), now()) returning id`;
  const [delPool] = await owner<{ id: string }[]>`
    insert into jobs (user_id, company_raw, title, title_normalized, public_job_id)
    values (${TESTER}, 'Empresa A', 'Abogado/a societario', 'abogado societario', ${pub!.id}) returning id`;
  const [propia] = await owner<{ id: string }[]>`
    insert into jobs (user_id, company_raw, title, title_normalized)
    values (${TESTER}, 'Mi Empresa Real', 'Puesto cargado a mano', 'puesto cargado a mano') returning id`;
  await newEvaluation(TESTER, delPool!.id, { verdict: "de_acuerdo" });
  await newEvaluation(TESTER, propia!.id, {
    verdict: "en_desacuerdo",
    note: "Leyó mal la modalidad",
    humanScore: 6,
  });
  // No salen: versión vieja marcada, y versión nueva sin marcar
  await newEvaluation(TESTER, delPool!.id, {
    prompt: "evaluate_job@v1.4.0",
    verdict: "de_acuerdo",
  });
  await newEvaluation(TESTER, propia!.id, {});
}, 180_000);

afterAll(async () => {
  if (owner) {
    await owner`delete from jobs where user_id in ${owner([TESTER, COMUN])}`;
    await owner`delete from public_jobs where external_id = ${EXTERNAL_ID}`;
    await owner`delete from app_admins where user_id = ${ADMIN}`;
    await owner`delete from users where id in ${owner([ADMIN, TESTER, COMUN])}`;
    await owner.end();
  }
  await app?.end();
  await container?.stop();
});

type Row = Record<string, unknown>;
const marks = (as: string) =>
  asUser(as, (tx) => tx<Row[]>`select * from public.admin_calibration_marks()`);

describe("admin_calibration_marks", () => {
  it("una persona común y un tester que no es admin reciben «no autorizado»", async () => {
    await expect(marks(COMUN)).rejects.toThrow(/no autorizado/);
    await expect(marks(TESTER)).rejects.toThrow(/no autorizado/);
  });

  it("sin sesión tampoco", async () => {
    await expect(
      app.begin(async (tx) => tx`select * from public.admin_calibration_marks()`),
    ).rejects.toThrow(/no autorizado/);
  });

  it("el admin ve solo lo marcado de la evaluación nueva", async () => {
    const rows = await marks(ADMIN);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => /^evaluate_job@v1\.5/.test(String(r.prompt_version)))).toBe(true);
    expect(rows.map((r) => r.verdict).sort()).toEqual(["de_acuerdo", "en_desacuerdo"]);
    const mala = rows.find((r) => r.verdict === "en_desacuerdo")!;
    expect(mala).toMatchObject({
      note: "Leyó mal la modalidad",
      human_score: 6,
      blockers: 1,
      discipline: "abogacia",
      modality: "presencial",
    });
    expect(String(mala.marked_at)).toContain("2026");
  });

  it("sin datos personales: ni email, ni nombre, ni user_id, ni el id de la oferta", async () => {
    const rows = await marks(ADMIN);
    const columnas = Object.keys(rows[0]!);
    expect(columnas.filter((c) => /mail|name|nombre|user|^id$|job_id/i.test(c))).toEqual([]);
    const todo = JSON.stringify(rows);
    expect(todo).not.toContain(EMAIL_TESTER);
    expect(todo).not.toContain(TESTER);
    expect(todo).not.toContain("Ficticio");
    for (const r of rows) {
      expect(String(r.person)).toHaveLength(6);
      expect(String(r.job_ref)).toHaveLength(8);
      expect(TESTER.replaceAll("-", "")).not.toContain(String(r.person));
    }
  });

  it("título y empresa solo de avisos del pool; una oferta cargada a mano sale sin ellos", async () => {
    const rows = await marks(ADMIN);
    const delPool = rows.find((r) => r.verdict === "de_acuerdo")!;
    const propia = rows.find((r) => r.verdict === "en_desacuerdo")!;
    expect(delPool).toMatchObject({ title: "Abogado/a societario", company: "Empresa A" });
    expect(propia.title).toBeNull();
    expect(propia.company).toBeNull();
    expect(JSON.stringify(rows)).not.toContain("Mi Empresa Real");
  });

  it("la persona es siempre la misma para el mismo user_id y distinta entre personas", async () => {
    const rows = await marks(ADMIN);
    expect(new Set(rows.map((r) => r.person)).size).toBe(1);
  });

  it("no hay manera de pedir lo de otra persona: la función no recibe una persona", async () => {
    const [fn] = await owner<{ args: string }[]>`
      select pg_get_function_arguments(p.oid) as args from pg_proc p
      where p.proname = 'admin_calibration_marks' and p.pronamespace = 'public'::regnamespace`;
    expect(fn!.args).toBe("p_limit integer DEFAULT 500");
  });

  it("sin EXECUTE para PUBLIC", async () => {
    const [r] = await owner<{ ok: boolean }[]>`
      select has_function_privilege('public', 'public.admin_calibration_marks(integer)', 'EXECUTE') as ok`;
    expect(r!.ok).toBe(false);
  });
});
