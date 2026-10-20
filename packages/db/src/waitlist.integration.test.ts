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
}, 180_000);

beforeEach(async () => {
  await owner`delete from waitlist where email like '%@example.com'`;
});

afterAll(async () => {
  if (owner) await owner`delete from waitlist where email like '%@example.com'`;
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
