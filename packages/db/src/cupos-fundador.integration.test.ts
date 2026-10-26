import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "./migrate";

/**
 * Cupos de fundador por carrera (C-13b, rls/0012) por el camino real: la app como jobsearch_app. La
 * función cuenta personas con plan fundador vigente por su carrera principal; solo responde a
 * app_admins y enmascara los grupos de menos de 3. Datos inventados.
 */
const APP_PASSWORD = "jobsearch_app_test";
const ADMIN_ID = "d9200000-0000-4000-8000-0000000000aa";
const NO_ADMIN_ID = "d9200000-0000-4000-8000-0000000000bb";

type Seed = {
  roles: string[];
  targetRole?: string | null;
  plan: string;
  /** SQL de plan_until: null, "future" o "past". */
  until: null | "future" | "past";
};

// backend: 3 vigentes (una sin fecha, dos con fecha futura) + 1 vencida + 1 con plan «lista»
// frontend: 2 vigentes (enmascarado) · qa: 1 por target_role con la lista vacía (enmascarado)
// sin carrera: texto libre x2, clave vieja, ninguna, «total», «» y «sin_carrera» (7) · gratis: no cuenta
const SEEDS: Seed[] = [
  { roles: ["backend"], plan: "fundador", until: null },
  { roles: ["backend", "frontend"], plan: "fundador", until: "future" },
  { roles: ["backend"], plan: "fundador", until: "future" },
  { roles: ["backend"], plan: "fundador", until: "past" },
  { roles: ["backend"], plan: "lista", until: null },
  { roles: ["frontend"], plan: "fundador", until: null },
  { roles: ["frontend"], plan: "fundador", until: null },
  { roles: [], targetRole: "qa", plan: "fundador", until: null },
  { roles: ["texto libre uno"], plan: "fundador", until: null },
  { roles: ["texto libre dos"], plan: "fundador", until: null },
  { roles: ["producto_proyectos"], plan: "fundador", until: null },
  { roles: [], plan: "fundador", until: null },
  { roles: ["backend"], plan: "gratis", until: null },
  // Claves que chocan con las filas especiales o vacías: también «sin carrera»
  { roles: ["total"], plan: "fundador", until: null },
  { roles: [""], plan: "fundador", until: null },
  { roles: ["sin_carrera"], plan: "fundador", until: null },
];
const IDS = SEEDS.map((_, i) => `d9200000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`);
const ALL = [ADMIN_ID, NO_ADMIN_ID, ...IDS];

type Count = { role: string; people: number | null };

let container: StartedPostgreSqlContainer | null = null;
let owner: Sql;
let app: Sql;

async function asUser<T>(userId: string, fn: (tx: Sql) => Promise<T>): Promise<T> {
  return (await app.begin(async (tx) => {
    await tx`select set_config('app.user_id', ${userId}, true)`;
    return fn(tx as unknown as Sql);
  })) as T;
}

async function counts(userId = ADMIN_ID): Promise<Record<string, number | null>> {
  const rows = await asUser(
    userId,
    (tx) => tx<Count[]>`select role, people from admin_founder_counts()`,
  );
  return Object.fromEntries(rows.map((r) => [r.role, r.people]));
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
  for (const id of ALL) {
    await owner`insert into users (id, email, name) values (${id}, ${`${id.slice(-4)}@ejemplo.test`}, 'Ficticio')
      on conflict (id) do nothing`;
    await owner`insert into profiles (user_id, display_name, location_country, inbound_address)
      values (${id}, 'Ficticio', 'AR', ${`f${id.slice(-6)}`})
      on conflict (user_id) do nothing`;
  }
  // El plan lo asigna el dueño (trigger de rls/0010): acá se conecta como dueño
  for (const [i, s] of SEEDS.entries()) {
    const until =
      s.until === "future"
        ? owner`now() + interval '30 days'`
        : s.until === "past"
          ? owner`now() - interval '1 day'`
          : owner`null::timestamptz`;
    await owner`update profiles set target_roles = ${s.roles}, target_role = ${s.targetRole ?? null},
      plan = ${s.plan}, plan_until = ${until} where user_id = ${IDS[i]!}`;
  }
  await owner`insert into app_admins (user_id) values (${ADMIN_ID}) on conflict do nothing`;
}, 180_000);

afterAll(async () => {
  if (owner) {
    await owner`delete from profiles where user_id in ${owner(ALL)}`;
    await owner`delete from app_admins where user_id = ${ADMIN_ID}`;
    await owner`delete from users where id in ${owner(ALL)}`;
  }
  await app?.end();
  await owner?.end();
  await container?.stop();
});

describe("cupos de fundador (C-13b)", () => {
  it("un no admin recibe un error y nada más", async () => {
    await expect(counts(NO_ADMIN_ID)).rejects.toThrow(/admin_founder_counts: no autorizado/);
  });

  it("un admin ve los conteos por carrera; menos de 3 personas vuelve null", async () => {
    const c = await counts();
    // backend: 3 vigentes (la vencida y la de plan «lista» no cuentan)
    expect(c.backend).toBe(3);
    // frontend (2) y qa (1) quedan por debajo de k
    expect(c.frontend).toBeNull();
    expect(c.qa).toBeNull();
  });

  it("un plan vencido no cuenta y un plan que no es fundador tampoco", async () => {
    const c = await counts();
    // frontend y qa están ocultos, así que el total también va en null (no se deduce el grupo oculto)
    expect(c.total).toBeNull();
    expect(Object.keys(c).sort()).toEqual(["backend", "frontend", "qa", "sin_carrera", "total"]);
  });

  it("claves inválidas, «total», vacía y «sin_carrera» caen en «sin carrera»; su texto no sale", async () => {
    const c = await counts();
    // texto libre x2, clave vieja, ninguna, «total», «» y «sin_carrera»
    expect(c.sin_carrera).toBe(7);
    expect(JSON.stringify(c)).not.toContain("texto libre");
    expect(JSON.stringify(c)).not.toContain("producto_proyectos");
  });

  it("ningún grupo oculto: el total se ve y no cuenta vencidos, «lista» ni «gratis»", async () => {
    // frontend y qa pasan a gratis: quedan backend (3) y sin carrera (7)
    const ids = owner([IDS[5]!, IDS[6]!, IDS[7]!]);
    await owner`update profiles set plan = 'gratis' where user_id in ${ids}`;
    const c = await counts();
    await owner`update profiles set plan = 'fundador' where user_id in ${ids}`;
    expect(c).toEqual({ backend: 3, sin_carrera: 7, total: 10 });
  });

  it("«sin carrera» con menos de 3 personas se oculta y arrastra al total", async () => {
    // Quedan backend (3) y dos en «sin carrera» (los de «» y «sin_carrera»)
    const ids = owner([IDS[5]!, IDS[6]!, IDS[7]!, IDS[8]!, IDS[9]!, IDS[10]!, IDS[11]!, IDS[13]!]);
    await owner`update profiles set plan = 'gratis' where user_id in ${ids}`;
    const c = await counts();
    await owner`update profiles set plan = 'fundador' where user_id in ${ids}`;
    expect(c).toEqual({ backend: 3, sin_carrera: null, total: null });
  });

  it("un grupo que llega a 3 personas se muestra", async () => {
    await owner`update profiles set plan = 'fundador', plan_until = null where user_id = ${IDS[3]!}`;
    expect((await counts()).backend).toBe(4);
    await owner`update profiles set plan_until = now() - interval '1 day' where user_id = ${IDS[3]!}`;
  });
});
