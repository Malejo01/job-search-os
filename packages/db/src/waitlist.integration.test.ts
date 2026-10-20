import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applyMigrations } from "./migrate";

/**
 * Lista de espera pública (ronda 63) por el camino real: la app como jobsearch_app, sin sesión. La
 * tabla no se lee ni se escribe directo; todo entra por waitlist_join (SECURITY DEFINER). Datos inventados.
 */
const APP_PASSWORD = "jobsearch_app_test";

let container: StartedPostgreSqlContainer | null = null;
let owner: Sql;
let app: Sql;

async function join(
  email: string,
  opts: { name?: string; role?: string; heard?: string | null; ip?: string | null } = {},
): Promise<string> {
  const rows = await app<{ status: string }[]>`
    select waitlist_join(${opts.name ?? "Persona Uno"}, ${email}, ${opts.role ?? "frontend"},
                         ${opts.heard ?? null}, ${opts.ip ?? null}) as status`;
  return rows[0]!.status;
}

/** Una transacción de la app con app.user_id puesto (lo que hace withUser en la web). */
const ADMIN_ID = "d9000000-0000-4000-8000-0000000000bb";
const PLAIN_ID = "d9000000-0000-4000-8000-0000000000cc";

async function asUser<T>(fn: (tx: Sql) => Promise<T>, userId: string = ADMIN_ID): Promise<T> {
  return (await app.begin(async (tx) => {
    await tx`select set_config('app.user_id', ${userId}, true)`;
    return fn(tx as unknown as Sql);
  })) as T;
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
  app = postgres(u.toString(), { max: 4, prepare: false });
  await owner`insert into users (id, email, name) values
    (${ADMIN_ID}, 'admin-espera@ejemplo.test', 'Admin Ficticio'),
    (${PLAIN_ID}, 'comun-espera@ejemplo.test', 'Comun Ficticio')
    on conflict (id) do nothing`;
  await owner`insert into app_admins (user_id) values (${ADMIN_ID}) on conflict do nothing`;
}, 180_000);

beforeEach(async () => {
  await owner`delete from waitlist where email like '%@example.com'`;
});

afterAll(async () => {
  if (owner) {
    await owner`delete from waitlist where email like '%@example.com'`;
    await owner`delete from users where id in (${ADMIN_ID}, ${PLAIN_ID})`;
  }
  await app?.end();
  await owner?.end();
  await container?.stop();
});

describe("lista de espera (ronda 63)", () => {
  it("la tabla tiene RLS activo", async () => {
    const [row] =
      await owner`select relrowsecurity as rls from pg_class where relname = 'waitlist'`;
    expect(row).toEqual({ rls: true });
  });

  it("el rol de la app no puede leer ni insertar directo", async () => {
    await join("persona@example.com");
    const denied = /permission denied|row-level security/;
    await expect(app`select count(*)::int as n from waitlist`).rejects.toThrow(denied);
    await expect(
      app`insert into waitlist (email, name, role) values ('directo@example.com', 'X', 'frontend')`,
    ).rejects.toThrow(denied);
    await expect(app`update waitlist set name = 'Otro' where true`).rejects.toThrow(denied);
    await expect(app`delete from waitlist where true`).rejects.toThrow(denied);
    const [stored] =
      await owner`select count(*)::int as n from waitlist where email = 'persona@example.com'`;
    expect(stored!.n).toBe(1);
  });

  it("ok la primera vez y duplicate después, también con otras mayúsculas y espacios", async () => {
    expect(await join("Persona@Example.com", { name: "  Persona Uno " })).toBe("ok");
    expect(await join("persona@example.com")).toBe("duplicate");
    expect(await join("  PERSONA@EXAMPLE.COM ")).toBe("duplicate");
    const rows =
      await owner`select email, name, heard_from from waitlist where email like '%@example.com'`;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      email: "persona@example.com",
      name: "Persona Uno",
      heard_from: null,
    });
  });

  it("una carrera que no es de la lista no entra", async () => {
    await expect(join("rol@example.com", { role: "astronauta" })).rejects.toThrow(
      /waitlist_role_check/,
    );
  });

  it("rechaza campos demasiado largos", async () => {
    await expect(join("largo@example.com", { name: "x".repeat(121) })).rejects.toThrow(/nombre/);
    await expect(join(`${"a".repeat(250)}@example.com`)).rejects.toThrow(/email/);
    await expect(join("largo@example.com", { heard: "x".repeat(201) })).rejects.toThrow(
      /enteraste/,
    );
  });

  it("el sexto pedido de la misma IP en una hora da rate_limited", async () => {
    for (let i = 1; i <= 5; i++) {
      expect(await join(`ip${i}@example.com`, { ip: "hash-ip-a" })).toBe("ok");
    }
    expect(await join("ip6@example.com", { ip: "hash-ip-a" })).toBe("rate_limited");
    expect(await join("ip6@example.com", { ip: "hash-ip-b" })).toBe("ok");
    const [row] =
      await owner`select count(*)::int as n from waitlist where email = 'ip6@example.com'`;
    expect(row!.n).toBe(1);
  });

  it("sin IP el límite igual corre: comparten un solo bucket", async () => {
    for (let i = 1; i <= 5; i++) {
      expect(await join(`sinip${i}@example.com`, { ip: null })).toBe("ok");
    }
    expect(await join("sinip6@example.com", { ip: null })).toBe("rate_limited");
  });

  it("el tope global de 30 cada 10 minutos frena la inundación", async () => {
    await owner`insert into waitlist (email, name, role, ip_hash)
                select 'flood' || g || '@example.com', 'Persona', 'frontend', 'hash-flood-' || g
                from generate_series(1, 30) g`;
    expect(await join("nueva@example.com", { ip: "hash-otra" })).toBe("rate_limited");
  });

  it("el tope diario de 300 frena aunque pasaran más de 10 minutos", async () => {
    await owner`insert into waitlist (email, name, role, ip_hash, created_at)
                select 'dia' || g || '@example.com', 'Persona', 'frontend', 'hash-dia-' || g,
                       now() - interval '2 hours'
                from generate_series(1, 300) g`;
    expect(await join("nueva@example.com", { ip: "hash-otra" })).toBe("rate_limited");
  });

  it("el rol de la app no tiene privilegios de tabla", async () => {
    const [row] = await owner<{ sel: boolean; ins: boolean }[]>`
      select has_table_privilege('jobsearch_app', 'waitlist', 'SELECT') as sel,
             has_table_privilege('jobsearch_app', 'waitlist', 'INSERT') as ins`;
    expect(row).toEqual({ sel: false, ins: false });
  });

  it("las funciones de administración fallan sin app.user_id y con un usuario que no es admin", async () => {
    const id = "d9000000-0000-4000-8000-000000000001";
    const denied = /waitlist_admin: no autorizado/;
    await expect(app`select * from waitlist_admin_list(500)`).rejects.toThrow(denied);
    await expect(app`select * from waitlist_admin_get(${id}::uuid)`).rejects.toThrow(denied);
    await expect(app`select waitlist_admin_mark_invited(${id}::uuid, ${id}::uuid)`).rejects.toThrow(
      denied,
    );
    await expect(app`select waitlist_admin_delete(${id}::uuid)`).rejects.toThrow(denied);
    // Con sesión pero sin fila en app_admins
    const plain = <T>(fn: (tx: Sql) => Promise<T>) => asUser(fn, PLAIN_ID);
    await expect(plain((tx) => tx`select * from waitlist_admin_list(500)`)).rejects.toThrow(denied);
    await expect(plain((tx) => tx`select * from waitlist_admin_get(${id}::uuid)`)).rejects.toThrow(
      denied,
    );
    await expect(
      plain((tx) => tx`select waitlist_admin_mark_invited(${id}::uuid, ${id}::uuid)`),
    ).rejects.toThrow(denied);
    await expect(plain((tx) => tx`select waitlist_admin_delete(${id}::uuid)`)).rejects.toThrow(
      denied,
    );
  });

  it("app_admins no se puede leer ni escribir con el rol de la app", async () => {
    const denied = /permission denied|row-level security/;
    await expect(app`select count(*)::int as n from app_admins`).rejects.toThrow(denied);
    await expect(app`insert into app_admins (user_id) values (${PLAIN_ID}::uuid)`).rejects.toThrow(
      denied,
    );
  });

  it("waitlist_admin_get devuelve id, email e invited_at de una sola fila, sin ip_hash", async () => {
    await join("uno@example.com");
    const [row] = await owner<
      { id: string }[]
    >`select id from waitlist where email = 'uno@example.com'`;
    const got = await asUser(
      (tx) => tx<Record<string, unknown>[]>`select * from waitlist_admin_get(${row!.id}::uuid)`,
    );
    expect(got).toHaveLength(1);
    expect(Object.keys(got[0]!).sort()).toEqual(["email", "id", "invited_at"]);
    expect(got[0]!.email).toBe("uno@example.com");
    const none = await asUser(
      (tx) => tx`select * from waitlist_admin_get('d9000000-0000-4000-8000-000000000002'::uuid)`,
    );
    expect(none).toHaveLength(0);
  });

  it("waitlist_admin_delete también borra la invitación sin usar, pero no la ya usada", async () => {
    await join("sinusar@example.com");
    await join("usada@example.com");
    const ids = await owner<{ id: string; email: string }[]>`
      select id, email from waitlist where email in ('sinusar@example.com', 'usada@example.com')`;
    const byEmail = Object.fromEntries(ids.map((r) => [r.email, r.id]));
    const [unused] = await owner<{ id: string }[]>`
      insert into invitations (code_hash, email, created_by_user_id)
      values ('hash-espera-sinusar', 'sinusar@example.com', ${ADMIN_ID}) returning id`;
    const [used] = await owner<{ id: string }[]>`
      insert into invitations (code_hash, email, created_by_user_id, used_at)
      values ('hash-espera-usada', 'usada@example.com', ${ADMIN_ID}, now()) returning id`;
    try {
      await owner`update waitlist set invited_at = now(), invitation_id = ${unused!.id}
                  where id = ${byEmail["sinusar@example.com"]!}`;
      await owner`update waitlist set invited_at = now(), invitation_id = ${used!.id}
                  where id = ${byEmail["usada@example.com"]!}`;
      for (const email of ["sinusar@example.com", "usada@example.com"]) {
        const [r] = await asUser(
          (tx) => tx<{ d: boolean }[]>`select waitlist_admin_delete(${byEmail[email]!}::uuid) as d`,
        );
        expect(r!.d).toBe(true);
      }
      const left = await owner<{ id: string }[]>`
        select id from invitations where id in (${unused!.id}, ${used!.id})`;
      expect(left.map((r) => r.id)).toEqual([used!.id]);
    } finally {
      await owner`delete from invitations where code_hash in ('hash-espera-sinusar', 'hash-espera-usada')`;
    }
  });

  it("waitlist_admin_list: sin ip_hash, sin invitar primero y tope de 500", async () => {
    await owner`insert into waitlist (email, name, role, ip_hash, created_at, invited_at)
                values ('vieja@example.com', 'Persona Vieja', 'backend', 'hash-secreto', now() - interval '3 hours', now()),
                       ('media@example.com', 'Persona Media', 'qa', 'hash-secreto', now() - interval '2 hours', null),
                       ('nueva@example.com', 'Persona Nueva', 'frontend', 'hash-secreto', now() - interval '1 hour', null)`;
    const rows = await asUser(
      (tx) => tx<Record<string, unknown>[]>`select * from waitlist_admin_list(500)`,
    );
    const mine = rows.filter((r) => String(r.email).endsWith("@example.com"));
    // Sin invitar primero y, dentro de cada grupo, las más nuevas primero
    expect(mine.map((r) => r.email)).toEqual([
      "nueva@example.com",
      "media@example.com",
      "vieja@example.com",
    ]);
    expect(Object.keys(mine[0]!).sort()).toEqual(
      ["created_at", "email", "heard_from", "id", "invited_at", "name", "role"].sort(),
    );
    expect(JSON.stringify(rows)).not.toContain("hash-secreto");
    const [capped] = await asUser(
      (tx) => tx<{ n: number }[]>`
      select count(*)::int as n from waitlist_admin_list(1)`,
    );
    expect(capped!.n).toBe(1);
  });

  it("waitlist_admin_mark_invited es idempotente: la segunda vez da false", async () => {
    await join("invitar@example.com");
    const [row] = await owner<
      { id: string }[]
    >`select id from waitlist where email = 'invitar@example.com'`;
    const inv = "d9000000-0000-4000-8000-0000000000aa";
    const mark = () =>
      asUser(
        (tx) =>
          tx<
            { changed: boolean }[]
          >`select waitlist_admin_mark_invited(${row!.id}::uuid, ${inv}::uuid) as changed`,
      );
    expect((await mark())[0]!.changed).toBe(true);
    expect((await mark())[0]!.changed).toBe(false);
    const [after] = await owner<{ invited: boolean; invitation_id: string }[]>`
      select invited_at is not null as invited, invitation_id from waitlist where id = ${row!.id}`;
    expect(after).toEqual({ invited: true, invitation_id: inv });
  });

  it("waitlist_admin_delete borra la fila y avisa si no había", async () => {
    await join("borrar@example.com");
    const [row] = await owner<
      { id: string }[]
    >`select id from waitlist where email = 'borrar@example.com'`;
    const del = () =>
      asUser((tx) => tx<{ d: boolean }[]>`select waitlist_admin_delete(${row!.id}::uuid) as d`);
    expect((await del())[0]!.d).toBe(true);
    expect((await del())[0]!.d).toBe(false);
    const [left] =
      await owner`select count(*)::int as n from waitlist where email = 'borrar@example.com'`;
    expect(left!.n).toBe(0);
  });

  it("después de las funciones de administración el rol de la app sigue sin SELECT directo", async () => {
    await asUser((tx) => tx`select * from waitlist_admin_list(500)`);
    await expect(app`select count(*)::int as n from waitlist`).rejects.toThrow(
      /permission denied|row-level security/,
    );
  });

  it("un ip_hash de hace más de 24 h queda en null después de una llamada", async () => {
    await owner`insert into waitlist (email, name, role, ip_hash, created_at)
                values ('vieja@example.com', 'Persona', 'backend', 'hash-viejo', now() - interval '25 hours'),
                       ('reciente@example.com', 'Persona', 'backend', 'hash-nuevo', now() - interval '2 hours')`;
    await join("gatillo@example.com");
    const rows = await owner<{ email: string; ip_hash: string | null }[]>`
      select email, ip_hash from waitlist where email in ('vieja@example.com', 'reciente@example.com')`;
    const byEmail = Object.fromEntries(rows.map((r) => [r.email, r.ip_hash]));
    expect(byEmail["vieja@example.com"]).toBeNull();
    expect(byEmail["reciente@example.com"]).toBe("hash-nuevo");
  });
});
