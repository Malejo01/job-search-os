import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { sql } from "drizzle-orm";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb } from "./client";
import { applyMigrations } from "./migrate";
import { USER_TABLES, deleteUserData } from "./user-tables";

/**
 * JS-092 · Borrado de cuenta por el camino real: como jobsearch_app, en una transacción con
 * app.user_id del usuario. Dos usuarios con datos en todas las tablas de USER_TABLES; borrar a A
 * deja 0 filas de A y las de B intactas. Datos inventados.
 */
const A = "a1000000-0000-4000-8000-000000000001";
const B = "b2000000-0000-4000-8000-000000000002";
const APP_PASSWORD = "jobsearch_app_test";

let container: StartedPostgreSqlContainer | null = null;
let owner: Sql;
let appConn: ReturnType<typeof createDb>;

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
  appConn = createDb(u.toString(), { max: 1 });

  await seed(A, "a");
  await seed(B, "b");
  // Invitación de B canjeada por A (con el email de A): al borrar a A tiene que quedar sin rastro
  await owner`insert into invitations (code_hash, created_by_user_id, email, used_at, used_by_user_id)
               values ('hash-b-usada-por-a', ${B}, 'a@example.test', now(), ${A})`;
}, 180_000);

afterAll(async () => {
  await appConn?.close();
  await owner?.end();
  await container?.stop();
});

/** Una fila por tabla de USER_TABLES para el usuario, como dueño (bypass RLS) */
async function seed(id: string, tag: string): Promise<void> {
  await owner`insert into users (id, email, password_hash) values (${id}, ${tag + "@example.test"}, 'x')`;
  await owner`insert into password_reset_tokens (user_id, token_hash, expires_at)
               values (${id}, ${"tok-" + tag}, now() + interval '1 hour')`;
  await owner`insert into profiles (user_id, display_name, location_country, inbound_address)
               values (${id}, ${"Persona " + tag}, 'AR', ${"u_" + tag + "@ingest.test"})`;
  await owner`insert into evaluation_criteria (user_id, version, active, rules)
               values (${id}, 1, true, '{}'::jsonb)`;
  const [job] = await owner<{ id: string }[]>`
    insert into jobs (user_id, company_raw, title, title_normalized)
    values (${id}, 'Empresa A', 'AI Engineer', 'ai engineer') returning id`;
  await owner`insert into job_sources (job_id, kind) values (${job!.id}, 'manual')`;
  await owner`insert into evaluations (job_id, user_id, criteria_version, prompt_version, model,
                had_full_jd, score, location_ok, modality, discipline, match_fuerte, gaps,
                bloqueadores_duros, senales_positivas, veredicto, accion)
              values (${job!.id}, ${id}, 1, 'p@v1', 'm', true, 7, 'ok', 'remoto', 'ai_engineer',
                '{}', '{}', '{}', '{}', 'ok', 'aplicar')`;
  await owner`insert into applications (job_id, user_id) values (${job!.id}, ${id})`;
  await owner`insert into application_answers (user_id, job_id, position, question, answer)
               values (${id}, ${job!.id}, 0, 'Q?', 'R')`;
  await owner`insert into answer_bank (user_id, question, question_normalized, answer, lang, source_job_id)
               values (${id}, 'Q?', 'q', 'R', 'es', ${job!.id})`;
  await owner`insert into candidate_facts (user_id, key, project, claim, source)
               values (${id}, 'k1', 'Proyecto', 'Afirmación', 'https://example.test')`;
  await owner`insert into application_settings (user_id, availability) values (${id}, 'inmediata')`;
  await owner`insert into contacts (user_id, name) values (${id}, 'Contacto A')`;
  await owner`insert into talent_platforms (user_id, name, status) values (${id}, 'Plataforma A', 'pendiente')`;
  const [skill] = await owner<{ id: string }[]>`
    insert into skills (slug, name, category) values (${"skill-" + tag}, 'Skill', 'otra') returning id`;
  await owner`insert into skill_levels (user_id, skill_id, level, confidence, state)
               values (${id}, ${skill!.id}, 2, 0.5, 'parcial')`;
  await owner`insert into skill_evidence (user_id, skill_id, type, description)
               values (${id}, ${skill!.id}, 'otra', 'evidencia')`;
  await owner`insert into skill_interviews (user_id, skill_id, question) values (${id}, ${skill!.id}, 'Q?')`;
  await owner`insert into market_snapshots (user_id, week_start, skill_id, mentions, must_mentions, weighted_demand)
               values (${id}, '2026-01-05', ${skill!.id}, 1, 1, 1)`;
  const [resource] = await owner<{ id: string }[]>`
    insert into learning_resources (skill_id, title, provider, url, target_level, created_by_user_id)
    values (${skill!.id}, 'Curso', 'Proveedor A', 'https://example.test/c', 2, ${id}) returning id`;
  await owner`insert into learning_resources (skill_id, title, provider, url, target_level, approved, created_by_user_id)
    values (${skill!.id}, ${"Curso aprobado " + tag}, 'Proveedor A', 'https://example.test/d', 2, true, ${id})`;
  await owner`insert into learning_plan_items (user_id, skill_id, resource_id, priority)
               values (${id}, ${skill!.id}, ${resource!.id}, 1)`;
  await owner`insert into llm_calls (user_id, task, model, ok) values (${id}, 'evaluate_job', 'm', true)`;
  await owner`insert into job_queue (queue, user_id, payload) values ('evaluate_job', ${id}, '{}'::jsonb)`;
  await owner`insert into raw_blobs (user_id, kind, content_type, body, bytes)
               values (${id}, 'inbound_email', 'message/rfc822', 'cuerpo', 6)`;
  await owner`insert into inbound_emails (user_id, from_address, raw_ref)
               values (${id}, 'alertas@example.test', 'pg:x')`;
  await owner`insert into inbound_rejections (user_id, window_start) values (${id}, now())`;
  await owner`insert into inbound_sender_domains (user_id, domain, verdict)
               values (${id}, 'example.test', 'empleo')`;
  await owner`insert into invitations (code_hash, created_by_user_id)
               values (${"hash-" + tag}, ${id})`;
}

/** Filas del usuario por entrada de USER_TABLES (como dueño, sin RLS) */
async function rowsOf(id: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const e of USER_TABLES) {
    const [r] = await owner<{ n: number }[]>`
      select count(*)::int as n from ${owner(e.table)} where ${owner(e.column)} = ${id}`;
    out[`${e.table}.${e.column}`] = r!.n;
  }
  const [u] = await owner<{ n: number }[]>`select count(*)::int as n from users where id = ${id}`;
  out.users = u!.n;
  return out;
}

async function asUser<T>(id: string, fn: (db: Parameters<typeof deleteUserData>[0]) => Promise<T>) {
  return appConn.db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.user_id', ${id}, true)`);
    return fn(tx);
  });
}

describe("borrado de cuenta (JS-092)", () => {
  it("cada usuario tiene datos en todas las tablas de la lista antes de borrar", async () => {
    // A también canjeó una invitación ajena (used_by_user_id); B no canjeó ninguna
    const emptyA = Object.entries(await rowsOf(A)).filter(([, n]) => n === 0);
    expect(emptyA).toEqual([]);
    const emptyB = Object.entries(await rowsOf(B)).filter(([, n]) => n === 0);
    expect(emptyB).toEqual([["invitations.used_by_user_id", 0]]);
  });

  it("un error en la transacción no borra nada (deshace todo)", async () => {
    const before = await rowsOf(A);
    await expect(
      asUser(A, async (db) => {
        await deleteUserData(db, A);
        throw new Error("falla simulada");
      }),
    ).rejects.toThrow("falla simulada");
    expect(await rowsOf(A)).toEqual(before);
  });

  it("borrar a A deja 0 filas de A en todas las tablas y las de B intactas", async () => {
    const beforeB = await rowsOf(B);
    const counts = await asUser(A, (db) => deleteUserData(db, A));

    const after = await rowsOf(A);
    expect(Object.entries(after).filter(([, n]) => n !== 0)).toEqual([]);
    expect(await rowsOf(B)).toEqual(beforeB);

    expect(counts.users).toBe(1);
    expect(counts["jobs.user_id"]).toBe(1);
    expect(counts["raw_blobs.user_id"]).toBe(1);
    expect(counts["inbound_emails.user_id"]).toBe(1);
    expect(counts["learning_resources.created_by_user_id:unapproved"]).toBe(1);
    expect(counts["learning_resources.created_by_user_id"]).toBe(1);

    // La invitación ajena que canjeó A sigue (es de B) pero sin su id ni su email
    const [inv] = await owner<{ used_by: string | null; email: string | null }[]>`
      select used_by_user_id as used_by, email from invitations where code_hash = 'hash-b-usada-por-a'`;
    expect(inv).toEqual({ used_by: null, email: null });

    // Lo cascadeado desde jobs también se fue
    const [src] = await owner<{ n: number }[]>`
      select count(*)::int as n from job_sources js
      where not exists (select 1 from jobs j where j.id = js.job_id)`;
    expect(src!.n).toBe(0);
  });

  it("el recurso de aprendizaje del usuario sigue en el catálogo, sin autor", async () => {
    const [kept] = await owner<{ n: number }[]>`
      select count(*)::int as n from learning_resources
      where title = 'Curso aprobado a' and created_by_user_id is null`;
    expect(kept!.n).toBe(1);
    // Los no aprobados que propuso A se borraron; los de B siguen
    const [gone] = await owner<{ a: number; b: number }[]>`
      select count(*) filter (where created_by_user_id = ${A})::int as a,
             count(*) filter (where created_by_user_id = ${B} and not approved)::int as b
      from learning_resources where title = 'Curso'`;
    expect(gone).toEqual({ a: 0, b: 1 });
  });

  it("si no puede borrar la fila de users, tira (no deja la cuenta a medias)", async () => {
    // A ya no existe: DELETE de users cuenta 0 y deleteUserData tiene que fallar
    await expect(asUser(A, (db) => deleteUserData(db, A))).rejects.toThrow(/users/);
  });
});
