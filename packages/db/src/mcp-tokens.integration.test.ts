import { createHash } from "node:crypto";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "./migrate";

/**
 * MCP-1 · Tokens personales del MCP, en la base. Por el camino real: la app se conecta como
 * jobsearch_app (NOBYPASSRLS). Cubre las policies de mcp_tokens (cada persona ve, crea y revoca solo
 * lo suyo) y mcp_token_user(): por hash devuelve el dueño, nunca el de otro; revocado, vencido o
 * inexistente no devuelve nada; la llamada 61 dentro del minuto sale con rate_limited. Datos
 * inventados; los "tokens" son textos de prueba sin forma de token real.
 */
const A = "a9100000-0000-4000-8000-000000000001";
const B = "b9100000-0000-4000-8000-000000000002";
const APP_PASSWORD = "jobsearch_app_test";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const HASH_A = sha("token-de-prueba-a");
const HASH_B = sha("token-de-prueba-b");
const HASH_REVOCADO = sha("token-de-prueba-revocado");
const HASH_VENCIDO = sha("token-de-prueba-vencido");

let container: StartedPostgreSqlContainer | undefined;
let owner: Sql;
let app: Sql;

async function asUser<T>(userId: string, fn: (tx: postgres.TransactionSql) => Promise<T>) {
  return (await app.begin(async (tx) => {
    await tx.unsafe(`SET LOCAL app.user_id = '${userId}'`);
    return fn(tx);
  })) as T;
}

/** Como la app en /api/mcp: sin sesión, solo la función. */
async function resolve(hash: string): Promise<{ user_id: string; rate_limited: boolean }[]> {
  return app<{ user_id: string; rate_limited: boolean }[]>`select * from mcp_token_user(${hash})`;
}

async function insertToken(userId: string, hash: string, extra = "") {
  await owner.unsafe(
    `insert into mcp_tokens (user_id, token_hash, label, expires_at, revoked_at)
     values ($1, $2, 'Chat de prueba', ${extra.includes("vencido") ? "now() - interval '1 minute'" : "now() + interval '30 days'"},
             ${extra.includes("revocado") ? "now()" : "null"})`,
    [userId, hash],
  );
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

  await owner`insert into users (id, email, password_hash) values (${A}, 'mcp-a@example.com', 'x')`;
  await owner`insert into users (id, email, password_hash) values (${B}, 'mcp-b@example.com', 'x')`;
  await insertToken(A, HASH_A);
  await insertToken(B, HASH_B);
  await insertToken(A, HASH_REVOCADO, "revocado");
  await insertToken(A, HASH_VENCIDO, "vencido");
}, 180_000);

afterAll(async () => {
  if (owner) {
    await owner`delete from mcp_tokens where user_id in ${owner([A, B])}`;
    await owner`delete from users where id in ${owner([A, B])}`;
  }
  await app?.end();
  await owner?.end();
  await container?.stop();
});

describe("mcp_token_user (MCP-1)", () => {
  it("cada hash resuelve a su dueño y nunca al de otra persona, aun alternando", async () => {
    for (let i = 0; i < 3; i++) {
      expect(await resolve(HASH_A)).toEqual([{ user_id: A, rate_limited: false }]);
      expect(await resolve(HASH_B)).toEqual([{ user_id: B, rate_limited: false }]);
    }
  });

  it("revocado, vencido, inexistente o mal formado: ninguna fila (la app no distingue)", async () => {
    expect(await resolve(HASH_REVOCADO)).toEqual([]);
    expect(await resolve(HASH_VENCIDO)).toEqual([]);
    expect(await resolve(sha("no-existe"))).toEqual([]);
    expect(await resolve("no-es-hex")).toEqual([]);
    expect(await resolve(HASH_A.toUpperCase())).toEqual([]);
  });

  it("marca last_used_at y no toca los tokens que no se usaron", async () => {
    const [b] = await owner<{ last: Date | null }[]>`
      select last_used_at as last from mcp_tokens where token_hash = ${HASH_B}`;
    const [rev] = await owner<{ last: Date | null }[]>`
      select last_used_at as last from mcp_tokens where token_hash = ${HASH_REVOCADO}`;
    expect(b!.last).not.toBeNull();
    expect(rev!.last).toBeNull();
  });

  it("la llamada 61 dentro de un minuto sale con rate_limited; la ventana nueva vuelve a empezar", async () => {
    await owner`update mcp_tokens set window_start = null, window_count = 0 where token_hash = ${HASH_A}`;
    for (let i = 1; i <= 60; i++) {
      const [r] = await resolve(HASH_A);
      expect(r, `llamada ${i}`).toEqual({ user_id: A, rate_limited: false });
    }
    expect(await resolve(HASH_A)).toEqual([{ user_id: A, rate_limited: true }]);
    // El tope es por token: B sigue libre
    expect(await resolve(HASH_B)).toEqual([{ user_id: B, rate_limited: false }]);
    // Pasado el minuto, arranca otra ventana en 1
    await owner`update mcp_tokens set window_start = now() - interval '61 seconds' where token_hash = ${HASH_A}`;
    expect(await resolve(HASH_A)).toEqual([{ user_id: A, rate_limited: false }]);
    const [w] = await owner<{ n: number }[]>`
      select window_count as n from mcp_tokens where token_hash = ${HASH_A}`;
    expect(w!.n).toBe(1);
  });

  it("search_path fijo, sin EXECUTE para PUBLIC y dueño distinto del rol de la app", async () => {
    const [f] = await owner<{ sp: string | null; pub: boolean; owner: string; definer: boolean }[]>`
      select (select c from unnest(p.proconfig) c where c like 'search_path=%') as sp,
             has_function_privilege('public', p.oid, 'EXECUTE') as pub,
             pg_get_userbyid(p.proowner) as owner, p.prosecdef as definer
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'mcp_token_user'`;
    expect(f!.definer).toBe(true);
    expect(f!.sp).toBe("search_path=pg_catalog, public");
    expect(f!.pub).toBe(false);
    expect(f!.owner).not.toBe("jobsearch_app");
  });
});

describe("policies de mcp_tokens (MCP-1)", () => {
  it("A ve solo sus tokens y nunca la fila de B", async () => {
    const rows = await asUser(A, (tx) => tx<{ user_id: string }[]>`select user_id from mcp_tokens`);
    expect(rows.length).toBe(3);
    expect(rows.every((r) => r.user_id === A)).toBe(true);
  });

  it("sin app.user_id no se ve nada", async () => {
    const rows = await app.begin((tx) => tx`select 1 from mcp_tokens`);
    expect(rows).toHaveLength(0);
  });

  it("A no puede crear un token a nombre de B ni uno de más de 30 días", async () => {
    await expect(
      asUser(
        A,
        (tx) => tx`insert into mcp_tokens (user_id, token_hash, label, expires_at)
                   values (${B}, ${sha("intruso")}, 'x', now() + interval '1 day')`,
      ),
    ).rejects.toThrow(/row-level security/);
    await expect(
      asUser(
        A,
        (tx) => tx`insert into mcp_tokens (user_id, token_hash, label, expires_at)
                   values (${A}, ${sha("largo")}, 'x', now() + interval '31 days')`,
      ),
    ).rejects.toThrow(/row-level security/);
    // Ni nacer revocado-y-reactivable ni con el contador cargado: solo el alta limpia
    await expect(
      asUser(
        A,
        (tx) => tx`insert into mcp_tokens (user_id, token_hash, label, expires_at, window_count)
                   values (${A}, ${sha("contador")}, 'x', now() + interval '1 day', 5)`,
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("A no revoca ni borra el token de B; B sigue resolviendo", async () => {
    const upd = await asUser(
      A,
      (tx) => tx`update mcp_tokens set revoked_at = now() where token_hash = ${HASH_B}`,
    );
    expect(upd.count).toBe(0);
    const del = await asUser(A, (tx) => tx`delete from mcp_tokens where token_hash = ${HASH_B}`);
    expect(del.count).toBe(0);
    expect((await resolve(HASH_B))[0]?.user_id).toBe(B);
  });

  it("un token revocado no se puede reactivar desde la app", async () => {
    await expect(
      asUser(
        A,
        (tx) => tx`update mcp_tokens set revoked_at = null where token_hash = ${HASH_REVOCADO}`,
      ),
    ).rejects.toThrow(/row-level security/);
    expect(await resolve(HASH_REVOCADO)).toEqual([]);
  });

  it("A crea y revoca el suyo; revocado deja de resolver al instante", async () => {
    const hash = sha("token-de-prueba-a-nuevo");
    await asUser(
      A,
      (tx) => tx`insert into mcp_tokens (user_id, token_hash, label, expires_at)
                 values (${A}, ${hash}, 'Otro chat', now() + interval '30 days')`,
    );
    expect((await resolve(hash))[0]?.user_id).toBe(A);
    const upd = await asUser(
      A,
      (tx) => tx`update mcp_tokens set revoked_at = now() where token_hash = ${hash}`,
    );
    expect(upd.count).toBe(1);
    expect(await resolve(hash)).toEqual([]);
  });

  it("los tokens caen con la cuenta (on delete cascade)", async () => {
    const C = "c9100000-0000-4000-8000-000000000003";
    await owner`insert into users (id, email, password_hash) values (${C}, 'mcp-c@example.com', 'x')`;
    const hash = sha("token-de-prueba-c");
    await insertToken(C, hash);
    expect((await resolve(hash))[0]?.user_id).toBe(C);
    await owner`delete from users where id = ${C}`;
    const [n] = await owner<{ n: number }[]>`
      select count(*)::int as n from mcp_tokens where user_id = ${C}`;
    expect(n!.n).toBe(0);
    expect(await resolve(hash)).toEqual([]);
  });
});
