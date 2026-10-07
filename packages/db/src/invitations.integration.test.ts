import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "./migrate";
import { hashPassword, verifyPassword } from "./password";

/**
 * JS-091 · Canje de invitaciones por el camino real: la app como jobsearch_app, sin sesión para
 * el canje (register_with_invitation, SECURITY DEFINER) y con app.user_id para listar/crear.
 * Mismos entornos que rls.integration.test.ts (CI: DATABASE_URL; local: Testcontainer).
 */
const CREATOR = "aaaaaaaa-0000-4000-8000-000000000001";
const OTHER = "aaaaaaaa-0000-4000-8000-000000000002";
const APP_PASSWORD = "jobsearch_app_test";

let container: StartedPostgreSqlContainer | null = null;
let owner: Sql;
let app: Sql;

async function createInvitation(
  by: string,
  codeHash: string,
  opts: { email?: string; expired?: boolean } = {},
): Promise<void> {
  await app.begin(async (tx) => {
    await tx.unsafe(`SET LOCAL app.user_id = '${by}'`);
    await tx`insert into invitations (code_hash, email, created_by_user_id, expires_at)
             values (${codeHash}, ${opts.email ?? null}, ${by},
                     ${opts.expired ? new Date(Date.now() - 1000) : new Date(Date.now() + 86_400_000)})`;
  });
}

async function register(codeHash: string, email: string, name: string | null = null) {
  const rows = await app<{ user_id: string | null }[]>`
    select register_with_invitation(${codeHash}, ${email}, ${hashPassword("contraseña-test")},
                                    ${name}, 'ingest.test') as user_id`;
  return rows[0]!.user_id;
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
  owner = postgres(ownerUrl, { max: 1, prepare: false });
  await owner.unsafe(`ALTER ROLE jobsearch_app WITH PASSWORD '${APP_PASSWORD}'`);
  const u = new URL(ownerUrl);
  u.username = "jobsearch_app";
  u.password = APP_PASSWORD;
  app = postgres(u.toString(), { max: 8, prepare: false });
  await owner`insert into users (id, email) values (${CREATOR}, 'creador@ejemplo.test'), (${OTHER}, 'otro@ejemplo.test')`;
}, 180_000);

afterAll(async () => {
  if (owner) {
    await owner`delete from profiles where user_id in (select id from users where email like '%@invitado.test')`;
    await owner`delete from invitations where created_by_user_id in (${CREATOR}, ${OTHER})`;
    await owner`delete from users where email like '%@invitado.test' or id in (${CREATOR}, ${OTHER})`;
  }
  await app?.end();
  await owner?.end();
  await container?.stop();
});

describe("registro por invitación (JS-091)", () => {
  it("la tabla invitations tiene RLS activo y forzado", async () => {
    const [row] = await owner`select relrowsecurity as rls, relforcerowsecurity as force
                              from pg_class where relname = 'invitations'`;
    expect(row).toEqual({ rls: true, force: true });
  });

  it("canje exitoso: crea usuario con contraseña verificable y perfil mínimo", async () => {
    await createInvitation(CREATOR, "hash-ok");
    const userId = await register("hash-ok", "  Nueva@Invitado.test ", "Persona Uno");
    expect(userId).toMatch(/^[0-9a-f-]{36}$/);
    const [user] = await owner`select email, name, password_hash from users where id = ${userId}`;
    expect(user!.email).toBe("nueva@invitado.test");
    expect(user!.name).toBe("Persona Uno");
    expect(verifyPassword("contraseña-test", user!.password_hash)).toBe(true);
    const [profile] =
      await owner`select display_name, inbound_address from profiles where user_id = ${userId}`;
    expect(profile!.display_name).toBe("Persona Uno");
    expect(profile!.inbound_address).toBe(`u_${userId!.slice(0, 8)}@ingest.test`);
    const [inv] =
      await owner`select used_at, used_by_user_id from invitations where code_hash = 'hash-ok'`;
    expect(inv!.used_at).not.toBeNull();
    expect(inv!.used_by_user_id).toBe(userId);
  });

  it("doble canje del mismo código: el segundo falla (NULL)", async () => {
    await createInvitation(CREATOR, "hash-doble");
    expect(await register("hash-doble", "uno@invitado.test")).not.toBeNull();
    expect(await register("hash-doble", "dos@invitado.test")).toBeNull();
  });

  it("canje concurrente del mismo código: gana uno solo y se crea un solo usuario", async () => {
    await createInvitation(CREATOR, "hash-carrera");
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) => register("hash-carrera", `carrera${i}@invitado.test`)),
    );
    expect(results.filter((r) => r !== null)).toHaveLength(1);
    const [count] =
      await owner`select count(*)::int as n from users where email like 'carrera%@invitado.test'`;
    expect(count!.n).toBe(1);
  });

  it("vencida, inexistente o de otro email: NULL, y la de otro email sigue vigente", async () => {
    await createInvitation(CREATOR, "hash-vencida", { expired: true });
    expect(await register("hash-vencida", "venc@invitado.test")).toBeNull();
    expect(await register("hash-no-existe", "nadie@invitado.test")).toBeNull();

    await createInvitation(CREATOR, "hash-email", { email: "Destino@Invitado.test" });
    expect(await register("hash-email", "otro@invitado.test")).toBeNull();
    expect(await register("hash-email", "destino@invitado.test")).not.toBeNull();
  });

  it("email ya registrado: falla y la invitación NO queda gastada", async () => {
    await createInvitation(CREATOR, "hash-dup");
    await expect(register("hash-dup", "nueva@invitado.test")).rejects.toThrow(
      /users_email|duplicate/,
    );
    const [inv] = await owner`select used_at from invitations where code_hash = 'hash-dup'`;
    expect(inv!.used_at).toBeNull();
  });

  it("RLS: cada usuario ve y revoca solo las suyas; no crea a nombre de otro", async () => {
    await createInvitation(OTHER, "hash-de-otro");
    const asUser = (id: string) =>
      app.begin(async (tx) => {
        await tx.unsafe(`SET LOCAL app.user_id = '${id}'`);
        return tx<{ code_hash: string }[]>`select code_hash from invitations`;
      });
    const seenByOther = (await asUser(OTHER)).map((r) => r.code_hash);
    expect(seenByOther).toEqual(["hash-de-otro"]);
    expect((await asUser(CREATOR)).map((r) => r.code_hash)).not.toContain("hash-de-otro");

    const deletedByCreator = await app.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL app.user_id = '${CREATOR}'`);
      return tx`delete from invitations where code_hash = 'hash-de-otro'`;
    });
    expect(deletedByCreator.count).toBe(0);

    await expect(
      app.begin(async (tx) => {
        await tx.unsafe(`SET LOCAL app.user_id = '${CREATOR}'`);
        await tx`insert into invitations (code_hash, created_by_user_id) values ('hash-falso', ${OTHER})`;
      }),
    ).rejects.toThrow(/row-level security/);
  });

  it("sin sesión la app no lee invitaciones ni inserta usuarios directo", async () => {
    const seen = await app`select count(*)::int as n from invitations`;
    expect(seen[0]!.n).toBe(0);
    await expect(app`insert into users (email) values ('directo@invitado.test')`).rejects.toThrow(
      /row-level security/,
    );
  });

  it("invitation_is_redeemable: true solo si el canje serviría, sin gastar la invitación", async () => {
    await createInvitation(CREATOR, "hash-pre", { email: "pre@invitado.test" });
    await createInvitation(CREATOR, "hash-pre-venc", { expired: true });
    const check = async (hash: string, email: string) =>
      (await app<{ ok: boolean }[]>`select invitation_is_redeemable(${hash}, ${email}) as ok`)[0]!
        .ok;
    expect(await check("hash-pre", "PRE@invitado.test")).toBe(true);
    expect(await check("hash-pre", "otro@invitado.test")).toBe(false);
    expect(await check("hash-pre-venc", "pre@invitado.test")).toBe(false);
    expect(await check("hash-no-existe", "pre@invitado.test")).toBe(false);
    const [inv] = await owner`select used_at from invitations where code_hash = 'hash-pre'`;
    expect(inv!.used_at).toBeNull();
  });

  it("release_invitations: quien canjeó se desvincula, solo a sí mismo y por esa función", async () => {
    await createInvitation(CREATOR, "hash-desvincular", { email: "desv@invitado.test" });
    const userId = (await register("hash-desvincular", "desv@invitado.test"))!;
    const release = (sessionUser: string, target: string) =>
      app.begin(async (tx) => {
        await tx.unsafe(`SET LOCAL app.user_id = '${sessionUser}'`);
        return tx<{ n: number }[]>`select release_invitations(${target}) as n`;
      });

    // Otra sesión no puede desvincular a un tercero
    await expect(release(CREATOR, userId)).rejects.toThrow(
      /solo se puede desvincular la cuenta propia/,
    );
    const [still] =
      await owner`select used_by_user_id from invitations where code_hash = 'hash-desvincular'`;
    expect(still!.used_by_user_id).toBe(userId);
    // Un UPDATE directo no existe para el rol de la app: no hay policy de UPDATE
    const direct = await app.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL app.user_id = '${userId}'`);
      return tx`update invitations set used_by_user_id = null where code_hash = 'hash-desvincular'`;
    });
    expect(direct.count).toBe(0);

    const [released] = await release(userId, userId);
    expect(released!.n).toBe(1);
    const [row] =
      await owner`select used_by_user_id, email, used_at from invitations where code_hash = 'hash-desvincular'`;
    expect(row!.used_by_user_id).toBeNull();
    expect(row!.email).toBeNull();
    expect(row!.used_at).not.toBeNull();
  });

  it("el canje funciona con un dueño SIN BYPASSRLS (como puede pasar en Neon)", async () => {
    const sqlFile = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "..", "rls", "0001_invitations.sql"),
      "utf8",
    );
    const [ownerRow] = await owner<{ name: string }[]>`select current_user as name`;
    const ownerName = ownerRow!.name;
    const fns = [
      "register_with_invitation(text, text, text, text, text)",
      "invitation_is_redeemable(text, text)",
      "release_invitations(uuid)",
    ];
    await owner.unsafe(`
      DROP ROLE IF EXISTS jso_nobypass;
      CREATE ROLE jso_nobypass NOLOGIN NOSUPERUSER NOBYPASSRLS;
      GRANT USAGE, CREATE ON SCHEMA public TO jso_nobypass;
      GRANT USAGE ON SCHEMA auth TO jso_nobypass;
      ALTER TABLE users OWNER TO jso_nobypass;
      ALTER TABLE profiles OWNER TO jso_nobypass;
      ALTER TABLE invitations OWNER TO jso_nobypass;
      ${fns.map((f) => `ALTER FUNCTION public.${f} OWNER TO jso_nobypass;`).join("\n")}
    `);
    try {
      const [role] =
        await owner`select rolbypassrls, rolsuper from pg_roles where rolname = 'jso_nobypass'`;
      expect(role).toEqual({ rolbypassrls: false, rolsuper: false });
      // La migración la aplica el nuevo dueño: TO CURRENT_USER queda atado a ese rol
      try {
        await owner.unsafe(`SET ROLE jso_nobypass; ${sqlFile}`);
      } finally {
        await owner.unsafe("RESET ROLE");
      }
      await createInvitation(CREATOR, "hash-sin-bypass");
      const userId = await register("hash-sin-bypass", "sinbypass@invitado.test", "Sin Bypass");
      expect(userId).not.toBeNull();
      const [profile] = await owner`select display_name from profiles where user_id = ${userId}`;
      expect(profile!.display_name).toBe("Sin Bypass");
    } finally {
      await owner.unsafe(`
        ALTER TABLE users OWNER TO ${ownerName};
        ALTER TABLE profiles OWNER TO ${ownerName};
        ALTER TABLE invitations OWNER TO ${ownerName};
        ${fns.map((f) => `ALTER FUNCTION public.${f} OWNER TO ${ownerName};`).join("\n")}
        ${sqlFile}
        DROP OWNED BY jso_nobypass; DROP ROLE jso_nobypass;
      `);
    }
  });
});
