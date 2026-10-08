import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "./migrate";
import { hashPassword, verifyPassword } from "./password";

/**
 * Rondas 14a/14c · `users` sin lectura cruzada. Como jobsearch_app (NOBYPASSRLS) y con un dueño de
 * tablas y funciones SIN BYPASSRLS (como puede pasar en Neon), sobre rls/ (que desde la 14c ya
 * cierra users_read y el bootstrap va por función) prueba que login, sesión, reset, MCP, /setup y
 * el registro v2 siguen andando por las funciones de rls/0003_auth_functions.sql. Datos inventados.
 */
const A = "a3000000-0000-4000-8000-000000000001";
const B = "b3000000-0000-4000-8000-000000000002";
const EMAIL_A = "persona-a@cuentas.test";
const EMAIL_B = "persona-b@cuentas.test";
const PASSWORD_A = "contraseña-a-test";
const PASSWORD_B = "contraseña-b-test";
const APP_PASSWORD = "jobsearch_app_test";
const NEW_FNS = [
  "auth_user_by_email(text)",
  "user_id_by_email(text)",
  "user_exists(uuid)",
  "check_reset_token(text)",
  "has_any_user()",
  "sole_user_id()",
  "register_with_invitation_v2(text, text, text, text, text, text)",
  "register_with_invitation_v3(text, text, text, text, text, text, text)",
];
const OLD_FNS = [
  "register_with_invitation(text, text, text, text, text)",
  "invitation_is_redeemable(text, text)",
  "release_invitations(uuid)",
];
const TABLES = ["users", "profiles", "invitations", "password_reset_tokens"];

const DB_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => readFileSync(join(DB_DIR, ...p), "utf8");

let container: StartedPostgreSqlContainer | null = null;
let owner: Sql;
let app: Sql;
let ownerName = "";
let migrateUrl = "";

/** Como la app para un usuario con sesión: app.user_id fijado en la transacción */
async function asUser<T>(userId: string, fn: (tx: postgres.TransactionSql) => Promise<T>) {
  return (await app.begin(async (tx) => {
    await tx.unsafe(`SET LOCAL app.user_id = '${userId}'`);
    return fn(tx);
  })) as T;
}

async function registerV2(codeHash: string, email: string, terms: string | null) {
  const rows = await app<{ user_id: string | null }[]>`
    select register_with_invitation_v2(${codeHash}, ${email}, ${hashPassword("contraseña-test")},
                                       ${"Persona Nueva"}, 'ingest.test', ${terms}) as user_id`;
  return rows[0]!.user_id;
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
  migrateUrl = ownerUrl;
  await applyMigrations(ownerUrl, { log: () => {} });
  owner = postgres(ownerUrl, { max: 1, prepare: false });
  await owner.unsafe(`ALTER ROLE jobsearch_app WITH PASSWORD '${APP_PASSWORD}'`);
  const u = new URL(ownerUrl);
  u.username = "jobsearch_app";
  u.password = APP_PASSWORD;
  app = postgres(u.toString(), { max: 4, prepare: false });
  const [row] = await owner<{ name: string }[]>`select current_user as name`;
  ownerName = row!.name;

  await owner`insert into users (id, email, password_hash)
              values (${A}, ${EMAIL_A}, ${hashPassword(PASSWORD_A)}),
                     (${B}, ${EMAIL_B}, ${hashPassword(PASSWORD_B)})`;
  await owner`insert into invitations (code_hash, created_by_user_id)
              values ('hash-v2-ok', ${A}), ('hash-v2-sin-terminos', ${A})`;

  // Dueño sin BYPASSRLS de tablas y funciones; las policies y funciones nuevas las aplica él
  await owner.unsafe(`
    DROP ROLE IF EXISTS jso_nobypass;
    CREATE ROLE jso_nobypass NOLOGIN NOSUPERUSER NOBYPASSRLS;
    GRANT USAGE, CREATE ON SCHEMA public TO jso_nobypass;
    GRANT USAGE ON SCHEMA auth TO jso_nobypass;
    ${TABLES.map((t) => `ALTER TABLE ${t} OWNER TO jso_nobypass;`).join("\n")}
    ${[...OLD_FNS, ...NEW_FNS].map((f) => `ALTER FUNCTION public.${f} OWNER TO jso_nobypass;`).join("\n")}
  `);
  try {
    await owner.unsafe(
      `SET ROLE jso_nobypass; ${read("rls", "0001_invitations.sql")} ${read("rls", "0003_auth_functions.sql")}`,
    );
  } finally {
    await owner.unsafe("RESET ROLE");
  }
}, 180_000);

afterAll(async () => {
  if (owner) {
    await owner.unsafe(`
      ${TABLES.map((t) => `ALTER TABLE ${t} OWNER TO ${ownerName};`).join("\n")}
      ${[...OLD_FNS, ...NEW_FNS].map((f) => `ALTER FUNCTION public.${f} OWNER TO ${ownerName};`).join("\n")}
    `);
    // Vuelve al estado de rls/ con las policies del dueño original
    await owner.unsafe(
      `${read("rls", "0000_policies.sql")} ${read("rls", "0001_invitations.sql")} ${read("rls", "0003_auth_functions.sql")}`,
    );
    await owner.unsafe("DROP OWNED BY jso_nobypass; DROP ROLE jso_nobypass;");
    await owner`delete from profiles where user_id in (select id from users where email like '%@cuentas.test')`;
    await owner`delete from invitations where created_by_user_id = ${A}`;
    await owner`delete from users where email like '%@cuentas.test'`;
  }
  await app?.end();
  await owner?.end();
  await container?.stop();
});

describe("users con lectura cerrada a la fila propia (JS-103, 14a)", () => {
  it("el dueño no tiene BYPASSRLS y el rol de la app tampoco", async () => {
    const rows = await owner`select rolname, rolbypassrls, rolsuper from pg_roles
                             where rolname in ('jso_nobypass', 'jobsearch_app') order by rolname`;
    expect(rows.map((r) => [r.rolname, r.rolbypassrls, r.rolsuper])).toEqual([
      ["jobsearch_app", false, false],
      ["jso_nobypass", false, false],
    ]);
  });

  it("el estado por defecto de rls/ ya es cerrado (fila propia y bootstrap por función)", async () => {
    const pols = await owner`select policyname, qual, with_check from pg_policies
                             where tablename in ('users', 'password_reset_tokens')
                               and policyname in ('users_read', 'users_bootstrap_insert', 'password_reset_tokens_read')`;
    expect(pols.find((p) => p.policyname === "users_read")!.qual).not.toBe("true");
    expect(pols.find((p) => p.policyname === "password_reset_tokens_read")!.qual).not.toBe("true");
    expect(pols.find((p) => p.policyname === "users_bootstrap_insert")!.with_check).toContain(
      "has_any_user",
    );
  });

  describe("con rls/ aplicado por el dueño sin BYPASSRLS", () => {
    it("A no lee los tokens de reset de B, ni B los de A", async () => {
      await owner`insert into password_reset_tokens (user_id, token_hash, expires_at)
                  values (${A}, 'cruz-a-cuentas', now() + interval '1 hour'),
                         (${B}, 'cruz-b-cuentas', now() + interval '1 hour')`;
      try {
        const a = await asUser(A, (tx) => tx`select token_hash from password_reset_tokens`);
        expect(a.map((r) => r.token_hash)).toEqual(["cruz-a-cuentas"]);
        const b = await asUser(B, (tx) => tx`select token_hash from password_reset_tokens`);
        expect(b.map((r) => r.token_hash)).toEqual(["cruz-b-cuentas"]);
      } finally {
        await owner`delete from password_reset_tokens where token_hash like 'cruz-%-cuentas'`;
      }
    });

    it("select * y filtro por email tampoco cruzan usuarios", async () => {
      const star = await asUser(A, (tx) => tx`select * from users`);
      expect(star.map((r) => r.id)).toEqual([A]);
      const like = await asUser(
        A,
        (tx) => tx`select id from users where email like '%@cuentas.test'`,
      );
      expect(like.map((r) => r.id)).toEqual([A]);
    });

    it("el dueño sin BYPASSRLS ve todas las filas de users (lo que usa el cron de mercado)", async () => {
      const rows = await owner.begin(async (tx) => {
        await tx.unsafe("SET LOCAL ROLE jso_nobypass");
        return tx`select id from users where id in (${A}, ${B})`;
      });
      expect(rows).toHaveLength(2);
    });

    it("/setup con users vacía: el INSERT de bootstrap pasa (se deshace al final)", async () => {
      class Rollback extends Error {}
      await expect(
        owner.begin(async (tx) => {
          await tx.unsafe("SET LOCAL session_replication_role = replica");
          await tx`delete from users`;
          await tx.unsafe("SET LOCAL ROLE jobsearch_app");
          // Sin RETURNING: devolver la fila exigiría pasar users_read, y sin sesión no se ve
          const ins = await tx`insert into users (email, password_hash)
                               values ('primero@cuentas.test', 'x')`;
          expect(ins.count).toBe(1);
          throw new Rollback();
        }),
      ).rejects.toBeInstanceOf(Rollback);
      expect(await owner`select 1 from users where id in (${A}, ${B})`).toHaveLength(2);
    });

    it("A no lee la fila de B (ni por id, ni por email, ni contando)", async () => {
      const byId = await asUser(A, (tx) => tx`select id from users where id = ${B}`);
      expect(byId).toHaveLength(0);
      const byEmail = await asUser(A, (tx) => tx`select id from users where email = ${EMAIL_B}`);
      expect(byEmail).toHaveLength(0);
      const all = await asUser(A, (tx) => tx`select id from users`);
      expect(all.map((r) => r.id)).toEqual([A]);
      // Sin sesión (app.user_id sin fijar) no ve ninguna
      expect(await app`select id from users`).toHaveLength(0);
    });

    it("el login de A y de B funciona por auth_user_by_email, sin sesión y con el email sin normalizar", async () => {
      const [a] = await app<
        { id: string; password_hash: string }[]
      >`select id, password_hash from auth_user_by_email(${"  " + EMAIL_A.toUpperCase() + " "})`;
      expect(a!.id).toBe(A);
      expect(verifyPassword(PASSWORD_A, a!.password_hash)).toBe(true);
      expect(verifyPassword(PASSWORD_B, a!.password_hash)).toBe(false);
      const [b] = await app<
        { id: string; password_hash: string }[]
      >`select id, password_hash from auth_user_by_email(${EMAIL_B})`;
      expect(b!.id).toBe(B);
      expect(verifyPassword(PASSWORD_B, b!.password_hash)).toBe(true);
      expect(await app`select * from auth_user_by_email('nadie@cuentas.test')`).toHaveLength(0);
    });

    it("user_id_by_email devuelve solo el id (reset de contraseña)", async () => {
      const [r] = await app<{ id: string | null }[]>`select user_id_by_email(${EMAIL_B}) as id`;
      expect(r!.id).toBe(B);
      const [none] = await app<
        { id: string | null }[]
      >`select user_id_by_email('x@cuentas.test') as id`;
      expect(none!.id).toBeNull();
    });

    it("el reset actualiza la contraseña con withUser (users_self_update) y no la de otro", async () => {
      const newHash = hashPassword("contraseña-nueva-b");
      const own = await asUser(
        B,
        (tx) => tx`update users set password_hash = ${newHash} where id = ${B}`,
      );
      expect(own.count).toBe(1);
      const other = await asUser(
        B,
        (tx) => tx`update users set password_hash = ${newHash} where id = ${A}`,
      );
      expect(other.count).toBe(0);
      await owner`update users set password_hash = ${hashPassword(PASSWORD_B)} where id = ${B}`;
    });

    it("user_exists y has_any_user responden bien", async () => {
      const [yes] = await app<{ ok: boolean }[]>`select user_exists(${B}::uuid) as ok`;
      const [no] = await app<
        { ok: boolean }[]
      >`select user_exists(${"c3000000-0000-4000-8000-000000000003"}::uuid) as ok`;
      expect(yes!.ok).toBe(true);
      expect(no!.ok).toBe(false);
      const [any] = await app<{ ok: boolean }[]>`select has_any_user() as ok`;
      expect(any!.ok).toBe(true);
    });

    it("/setup no puede insertar si ya hay usuarios (aunque la app no vea las filas)", async () => {
      await expect(
        app`insert into users (email, password_hash) values ('intruso@cuentas.test', 'x')`,
      ).rejects.toThrow(/row-level security/);
      await expect(
        asUser(
          A,
          (tx) => tx`insert into users (email, password_hash) values ('intruso@cuentas.test', 'x')`,
        ),
      ).rejects.toThrow(/row-level security/);
      const rows = await owner`select 1 from users where email = 'intruso@cuentas.test'`;
      expect(rows).toHaveLength(0);
    });

    it("sole_user_id da NULL con 2 usuarios y el id cuando queda uno solo", async () => {
      const [two] = await app<{ id: string | null }[]>`select sole_user_id() as id`;
      expect(two!.id).toBeNull();
      // El caso de uno solo se prueba únicamente en una base propia (Testcontainer): no se borran usuarios ajenos
      if (!container) return;
      const others = await owner`select id from users where id not in (${A}, ${B})`;
      if (others.length > 0) return;
      await owner`delete from users where id = ${B}`;
      const [one] = await app<{ id: string | null }[]>`select sole_user_id() as id`;
      expect(one!.id).toBe(A);
      await owner`insert into users (id, email, password_hash) values (${B}, ${EMAIL_B}, ${hashPassword(PASSWORD_B)})`;
    });

    it("registro v2: guarda versión y fecha de los términos, y deja el perfil mínimo", async () => {
      const before = Date.now();
      const userId = await registerV2("hash-v2-ok", "  Nueva@Cuentas.test ", "2026-10-07");
      expect(userId).toMatch(/^[0-9a-f-]{36}$/);
      const [user] =
        await owner`select email, terms_version, terms_accepted_at from users where id = ${userId}`;
      expect(user!.email).toBe("nueva@cuentas.test");
      expect(user!.terms_version).toBe("2026-10-07");
      expect(Math.abs((user!.terms_accepted_at as Date).getTime() - before)).toBeLessThan(60_000);
      const [profile] = await owner`select display_name from profiles where user_id = ${userId}`;
      expect(profile!.display_name).toBe("Persona Nueva");
      // La nueva cuenta puede entrar por la función
      const [login] = await app<
        { id: string }[]
      >`select id from auth_user_by_email('nueva@cuentas.test')`;
      expect(login!.id).toBe(userId);
    });

    it("check_reset_token resuelve un token sin sesión y la app ya no lista tokens ajenos", async () => {
      await owner`insert into password_reset_tokens (user_id, token_hash, expires_at)
                  values (${A}, 'tok-a-cuentas', now() + interval '1 hour'),
                         (${B}, 'tok-b-cuentas', now() + interval '1 hour')`;
      const [t] = await app<
        { user_id: string; expires_at: Date; used_at: Date | null }[]
      >`select user_id, expires_at, used_at from check_reset_token('tok-b-cuentas')`;
      expect(t!.user_id).toBe(B);
      expect(t!.used_at).toBeNull();
      expect(await app`select * from check_reset_token('no-existe')`).toHaveLength(0);
      expect(await app`select token_hash from password_reset_tokens`).toHaveLength(0);
      const own = await asUser(A, (tx) => tx`select token_hash from password_reset_tokens`);
      expect(own.map((r) => r.token_hash)).toEqual(["tok-a-cuentas"]);
      // Marcar los propios como usados sigue andando con withUser
      const upd = await asUser(
        A,
        (tx) => tx`update password_reset_tokens set used_at = now() where user_id = ${A}`,
      );
      expect(upd.count).toBe(1);
      await owner`delete from password_reset_tokens where token_hash like 'tok-%-cuentas'`;
    });

    it("registro v2 con un email ya registrado falla por unicidad y no gasta la invitación", async () => {
      await owner`insert into invitations (code_hash, created_by_user_id) values ('hash-v2-dup', ${A})`;
      await expect(registerV2("hash-v2-dup", EMAIL_A, "2026-10-07")).rejects.toMatchObject({
        code: "23505",
      });
      const [inv] = await owner`select used_at from invitations where code_hash = 'hash-v2-dup'`;
      expect(inv!.used_at).toBeNull();
    });

    it("registro v2 sin versión de términos no registra y no gasta la invitación", async () => {
      await expect(registerV2("hash-v2-sin-terminos", "sin@cuentas.test", null)).rejects.toThrow(
        /falta la versión de los términos/,
      );
      await expect(registerV2("hash-v2-sin-terminos", "sin@cuentas.test", "  ")).rejects.toThrow();
      expect(await owner`select 1 from users where email = 'sin@cuentas.test'`).toHaveLength(0);
      const [inv] =
        await owner`select used_at from invitations where code_hash = 'hash-v2-sin-terminos'`;
      expect(inv!.used_at).toBeNull();
    });

    it("la v1 existe pero el rol de la app ya no puede ejecutarla (JS-113)", async () => {
      await owner`insert into invitations (code_hash, created_by_user_id) values ('hash-v1', ${A})`;
      await expect(
        app`select register_with_invitation('hash-v1', 'v1@cuentas.test', ${hashPassword("contraseña-test")},
                                            null, 'ingest.test') as user_id`,
      ).rejects.toThrow(/permission denied/);
      expect(await owner`select 1 from users where email = 'v1@cuentas.test'`).toHaveLength(0);
      const [inv] = await owner`select used_at from invitations where code_hash = 'hash-v1'`;
      expect(inv!.used_at).toBeNull();
    });

    describe("registro v3 con dirección aleatoria (JS-113)", () => {
      const register = (codeHash: string, email: string, token: string | null) =>
        app<{ user_id: string | null }[]>`
          select register_with_invitation_v3(${codeHash}, ${email}, ${hashPassword("contraseña-test")},
                                             ${"Persona Nueva"}, 'ingest.test', '2026-10-07',
                                             ${token}) as user_id`;

      it("guarda u_<token>@<dominio> con el token recibido y los términos", async () => {
        await owner`insert into invitations (code_hash, created_by_user_id) values ('hash-v3-ok', ${A})`;
        const token = "abcdefghijklmnopqrst";
        const [r] = await register("hash-v3-ok", "v3@cuentas.test", token);
        expect(r!.user_id).not.toBeNull();
        const [p] = await owner`select inbound_address from profiles where user_id = ${r!.user_id}`;
        expect(p!.inbound_address).toBe(`u_${token}@ingest.test`);
        expect(p!.inbound_address).toMatch(/^u_[a-z2-7]{20}@ingest\.test$/);
        const [u] = await owner`select terms_version from users where id = ${r!.user_id}`;
        expect(u!.terms_version).toBe("2026-10-07");
      });

      it("un token inválido falla y no gasta la invitación", async () => {
        await owner`insert into invitations (code_hash, created_by_user_id) values ('hash-v3-mal', ${A})`;
        for (const bad of [
          null,
          "",
          "corto",
          "ABCDEFGHIJKLMNOPQRST",
          "abcdefghijklmnopqrs1",
          "abcdefghijklmnopqrstu",
          "abcdefghij@lmnopqrst",
        ]) {
          await expect(register("hash-v3-mal", "mal@cuentas.test", bad)).rejects.toThrow(
            /token de la dirección de ingesta no es válido/,
          );
        }
        expect(await owner`select 1 from users where email = 'mal@cuentas.test'`).toHaveLength(0);
        const [inv] = await owner`select used_at from invitations where code_hash = 'hash-v3-mal'`;
        expect(inv!.used_at).toBeNull();
      });

      it("un token repetido falla por unicidad y no gasta la invitación", async () => {
        const token = "zyxwvutsrqponmlkjihg";
        await owner`insert into invitations (code_hash, created_by_user_id) values ('hash-v3-dup', ${A})`;
        await owner`insert into profiles (user_id, display_name, location_country, inbound_address)
                    values (${A}, 'Persona A', 'XX', ${`u_${token}@ingest.test`})`;
        try {
          await expect(register("hash-v3-dup", "dup@cuentas.test", token)).rejects.toMatchObject({
            code: "23505",
          });
        } finally {
          await owner`delete from profiles where user_id = ${A}`;
        }
        const [inv] = await owner`select used_at from invitations where code_hash = 'hash-v3-dup'`;
        expect(inv!.used_at).toBeNull();
      });

      it("un dominio inválido falla y no gasta la invitación; el dominio se guarda en minúscula", async () => {
        await owner`insert into invitations (code_hash, created_by_user_id) values ('hash-v3-dom', ${A})`;
        const withDomain = (domain: string | null) =>
          app`select register_with_invitation_v3('hash-v3-dom', 'dom@cuentas.test',
                ${hashPassword("contraseña-test")}, 'Persona Nueva', ${domain}, '2026-10-07',
                'abcdefghijklmnopqrsu') as user_id`;
        for (const bad of [
          null,
          "",
          "a b.test",
          "x@y.test",
          "-ingest.test",
          "ingest.test-",
          "a/b",
        ]) {
          await expect(withDomain(bad)).rejects.toThrow(/dominio de ingesta no es válido/);
        }
        const [inv] = await owner`select used_at from invitations where code_hash = 'hash-v3-dom'`;
        expect(inv!.used_at).toBeNull();
        const [r] = await withDomain("  Ingest.TEST ");
        const [p] = await owner`select inbound_address from profiles where user_id = ${r!.user_id}`;
        expect(p!.inbound_address).toBe("u_abcdefghijklmnopqrsu@ingest.test");
      });
    });

    it("las funciones no son ejecutables por PUBLIC y sí por authenticated", async () => {
      const rows = await owner<{ proname: string; public_exec: boolean; auth_exec: boolean }[]>`
        select p.proname,
               has_function_privilege('public', p.oid, 'EXECUTE') as public_exec,
               has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_exec
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public'
           and p.proname in ('auth_user_by_email', 'user_id_by_email', 'user_exists', 'has_any_user',
                             'sole_user_id', 'register_with_invitation_v2', 'register_with_invitation_v3',
                             'check_reset_token')`;
      expect(rows).toHaveLength(8);
      for (const r of rows) {
        expect(r.public_exec, r.proname).toBe(false);
        expect(r.auth_exec, r.proname).toBe(true);
      }
    });

    it("con solo 0000 aplicado (0003 sin correr) /setup queda cerrado aunque users esté vacía", async () => {
      try {
        await owner.unsafe(read("rls", "0000_policies.sql"));
        const [pol] = await owner`select with_check from pg_policies
                                  where tablename = 'users' and policyname = 'users_bootstrap_insert'`;
        expect(pol!.with_check).toBe("false");
        await expect(
          owner.begin(async (tx) => {
            await tx.unsafe("SET LOCAL session_replication_role = replica");
            await tx`delete from users`;
            await tx.unsafe("SET LOCAL ROLE jobsearch_app");
            await tx`insert into users (email, password_hash) values ('primero@cuentas.test', 'x')`;
          }),
        ).rejects.toThrow(/row-level security/);
      } finally {
        await owner.unsafe(read("rls", "0003_auth_functions.sql"));
      }
      expect(await owner`select 1 from users where id in (${A}, ${B})`).toHaveLength(2);
    });

    // Último: applyMigrations reasigna las policies *_definer_select al rol que migra (el superusuario)
    it("dos corridas más de applyMigrations dejan las mismas policies, siempre cerradas", async () => {
      const snapshot = async () =>
        owner`select tablename, policyname, cmd, roles::text as roles, qual, with_check
                from pg_policies where schemaname = 'public' order by tablename, policyname`;
      await applyMigrations(migrateUrl, { log: () => {} });
      const first = await snapshot();
      await applyMigrations(migrateUrl, { log: () => {} });
      const second = await snapshot();
      expect(second).toEqual(first);
      const read = second.find((p) => p.policyname === "users_read")!;
      expect(read.qual).not.toBe("true");
      expect(second.find((p) => p.policyname === "password_reset_tokens_read")!.qual).not.toBe(
        "true",
      );
      expect(second.find((p) => p.policyname === "users_bootstrap_insert")!.with_check).toContain(
        "has_any_user",
      );
      expect(await app`select id from users`).toHaveLength(0);
    }, 120_000);
  });
});
