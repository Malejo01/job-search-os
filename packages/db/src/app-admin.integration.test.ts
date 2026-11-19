import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "./migrate";

/**
 * Permisos de administración en la base, por el camino real: la app se conecta como jobsearch_app
 * (NOBYPASSRLS) y la sesión es `app.user_id`. Datos inventados.
 */
const ADMIN = "bbbbbbbb-0000-4000-8000-000000000001";
const COMMON = "bbbbbbbb-0000-4000-8000-000000000002";
const APP_PASSWORD = "jobsearch_app_test";

let container: StartedPostgreSqlContainer | undefined;
let owner: Sql;
let app: Sql;

/** Corre `run` como la persona `userId`, igual que `withUser` en la app. */
async function asUser<T>(userId: string | null, run: (tx: Sql) => Promise<T>): Promise<T> {
  return (await app.begin(async (tx) => {
    if (userId) await tx.unsafe(`SET LOCAL app.user_id = '${userId}'`);
    return run(tx as unknown as Sql);
  })) as T;
}

async function isAppAdmin(userId: string | null): Promise<boolean> {
  return asUser(userId, async (tx) => {
    const [row] = await tx<{ ok: boolean }[]>`select is_app_admin() as ok`;
    return row!.ok;
  });
}

async function insertInvitation(userId: string, codeHash: string): Promise<void> {
  await asUser(userId, async (tx) => {
    await tx`insert into invitations (code_hash, created_by_user_id) values (${codeHash}, ${userId})`;
  });
}

async function isBound(codeHash: string, email: string): Promise<boolean> {
  const [row] = await app<{ ok: boolean }[]>`
    select invitation_is_bound_to_email(${codeHash}, ${email}) as ok`;
  return row!.ok;
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
  await owner`insert into users (id, email) values
    (${ADMIN}, 'admin-base@example.com'), (${COMMON}, 'lista-sin-fila@example.com')`;
  await owner`insert into app_admins (user_id) values (${ADMIN})`;
}, 180_000);

afterAll(async () => {
  if (owner) {
    await owner`delete from invitations where created_by_user_id in (${ADMIN}, ${COMMON})`;
    await owner`delete from app_admins where user_id in (${ADMIN}, ${COMMON})`;
    await owner`delete from users where id in (${ADMIN}, ${COMMON})`;
  }
  await app?.end();
  await owner?.end();
  await container?.stop();
});

describe("is_app_admin", () => {
  it("es verdadero solo para la sesión con fila en app_admins", async () => {
    expect(await isAppAdmin(ADMIN)).toBe(true);
    expect(await isAppAdmin(COMMON)).toBe(false);
  });

  it("sin sesión es falso", async () => {
    expect(await isAppAdmin(null)).toBe(false);
  });

  it("no recibe parámetros: mira solo la sesión", async () => {
    const rows = await owner<{ args: string }[]>`
      select pg_get_function_identity_arguments(p.oid) as args
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'is_app_admin'`;
    expect(rows).toEqual([{ args: "" }]);
  });
});

describe("crear invitaciones", () => {
  it("una cuenta con fila en app_admins puede crear", async () => {
    await expect(insertInvitation(ADMIN, "hash-admin-base")).resolves.toBeUndefined();
  });

  it("una cuenta sin fila en app_admins no puede crear, aunque figure en la lista de la app", async () => {
    await expect(insertInvitation(COMMON, "hash-sin-fila")).rejects.toThrow(/row-level security/i);
    const rows = await owner`select 1 from invitations where code_hash = 'hash-sin-fila'`;
    expect(rows).toHaveLength(0);
  });

  it("un admin no puede crear una invitación a nombre de otra cuenta", async () => {
    await expect(
      asUser(ADMIN, async (tx) => {
        await tx`insert into invitations (code_hash, created_by_user_id)
                 values ('hash-ajena', ${COMMON})`;
      }),
    ).rejects.toThrow(/row-level security/i);
  });
});

describe("invitation_is_bound_to_email", () => {
  beforeAll(async () => {
    await owner`insert into invitations (code_hash, email, created_by_user_id) values
      ('hash-atada', 'persona-atada@example.com', ${ADMIN}),
      ('hash-generica', null, ${ADMIN})`;
    await owner`insert into invitations (code_hash, email, created_by_user_id, expires_at) values
      ('hash-vencida', 'persona-atada@example.com', ${ADMIN}, now() - interval '1 day')`;
  });

  it("es verdadero con la invitación atada a ese email, sin importar mayúsculas ni espacios", async () => {
    expect(await isBound("hash-atada", "persona-atada@example.com")).toBe(true);
    expect(await isBound("hash-atada", "  Persona-Atada@Example.com ")).toBe(true);
  });

  it("es falso con una invitación sin email", async () => {
    expect(await isBound("hash-generica", "persona-atada@example.com")).toBe(false);
  });

  it("es falso con una invitación atada a otro email", async () => {
    expect(await isBound("hash-atada", "otra-persona@example.com")).toBe(false);
  });

  it("es falso con una invitación vencida o inexistente", async () => {
    expect(await isBound("hash-vencida", "persona-atada@example.com")).toBe(false);
    expect(await isBound("hash-que-no-existe", "persona-atada@example.com")).toBe(false);
  });
});
