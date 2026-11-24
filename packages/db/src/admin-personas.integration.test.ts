import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "./migrate";

/**
 * Panel /admin (ADM-1, rls/0064_admin_personas.sql) por el camino real: la app como jobsearch_app. Una
 * cuenta común no lista personas ni cambia nada; la admin lista, filtra, da y saca el rol tester, bloquea y
 * desbloquea, y marca cuentas de prueba, con cada cambio en el historial. Una cuenta bloqueada no inicia
 * sesión y su sesión deja de valer. Nunca se bloquea a una admin ni a la propia cuenta. Datos inventados.
 */
const APP_PASSWORD = "jobsearch_app_test";
const ADMIN_ID = "d9640000-0000-4000-8000-000000000001";
const PERSON_ID = "d9640000-0000-4000-8000-000000000002";
const OTHER_ID = "d9640000-0000-4000-8000-000000000003";
const ADMIN2_ID = "d9640000-0000-4000-8000-000000000004";
const IDS = [ADMIN_ID, PERSON_ID, OTHER_ID, ADMIN2_ID];
const EMAILS: Record<string, string> = {
  [ADMIN_ID]: "admin-panel@ejemplo.test",
  [PERSON_ID]: "persona-panel@ejemplo.test",
  [OTHER_ID]: "otra-panel@ejemplo.test",
  [ADMIN2_ID]: "admin2-panel@ejemplo.test",
};
const DENIED = /no autorizado/;

let container: StartedPostgreSqlContainer | null = null;
let owner: Sql;
let app: Sql;

async function asUser<T>(userId: string, run: (tx: Sql) => Promise<T>): Promise<T> {
  return (await app.begin(async (tx) => {
    await tx`select set_config('app.user_id', ${userId}, true)`;
    return run(tx as unknown as Sql);
  })) as T;
}

const one = async <T>(userId: string, q: (tx: Sql) => Promise<T[]>) =>
  (await asUser(userId, q))[0] as T;

beforeAll(async () => {
  let ownerUrl: string;
  if (process.env.DATABASE_URL) {
    ownerUrl = process.env.DATABASE_URL;
  } else {
    const pg = new PostgreSqlContainer("pgvector/pgvector:pg16").withDatabase("jobsearch");
    container = await pg.withUsername("postgres").withPassword("postgres").start();
    ownerUrl = container.getConnectionUri();
  }
  await applyMigrations(ownerUrl, { log: () => {} });
  owner = postgres(ownerUrl, { max: 1, prepare: false });
  await owner.unsafe(`ALTER ROLE jobsearch_app WITH PASSWORD '${APP_PASSWORD}'`);
  const u = new URL(ownerUrl);
  u.username = "jobsearch_app";
  u.password = APP_PASSWORD;
  app = postgres(u.toString(), { max: 4, prepare: false });
  for (const id of IDS) {
    await owner`insert into users (id, email, name) values (${id}, ${EMAILS[id]!}, 'Ficticio')
      on conflict (id) do nothing`;
  }
  await owner`insert into profiles (user_id, display_name, location_country, inbound_address)
    values (${PERSON_ID}, 'Ficticio', 'AR', 'u_panel_0002@ingest.test') on conflict (user_id) do nothing`;
  await owner`update profiles set plan = 'lista', plan_until = now() + interval '3 days', plan_source = 'pago'
    where user_id = ${PERSON_ID}`;
  await owner`insert into app_admins (user_id) values (${ADMIN_ID}), (${ADMIN2_ID}) on conflict do nothing`;
});

afterAll(async () => {
  if (owner) {
    await owner`delete from users where id = any(${IDS})`;
    await owner.end();
  }
  if (app) await app.end();
  if (container) await container.stop();
});

describe("panel de personas (ADM-1, rls/0064)", () => {
  it("una cuenta común no lista, no ve fichas ni cambia nada", async () => {
    await expect(asUser(OTHER_ID, (tx) => tx`select * from admin_people_list()`)).rejects.toThrow(
      DENIED,
    );
    await expect(
      asUser(OTHER_ID, (tx) => tx`select * from admin_person_get(${PERSON_ID})`),
    ).rejects.toThrow(DENIED);
    await expect(
      asUser(OTHER_ID, (tx) => tx`select admin_person_role(${OTHER_ID}, 'tester', true)`),
    ).rejects.toThrow(DENIED);
    await expect(
      asUser(OTHER_ID, (tx) => tx`select admin_person_block(${PERSON_ID}, true)`),
    ).rejects.toThrow(DENIED);
    await expect(asUser(OTHER_ID, (tx) => tx`select admin_panel_summary()`)).rejects.toThrow(
      DENIED,
    );
  });

  it("la app no lee ni escribe user_roles ni admin_events directamente", async () => {
    await expect(asUser(ADMIN_ID, (tx) => tx`select * from user_roles`)).rejects.toThrow();
    await expect(asUser(ADMIN_ID, (tx) => tx`select * from admin_events`)).rejects.toThrow();
    await expect(
      asUser(
        OTHER_ID,
        (tx) => tx`insert into user_roles (user_id, role) values (${OTHER_ID}, 'tester')`,
      ),
    ).rejects.toThrow();
    await expect(
      asUser(OTHER_ID, (tx) => tx`update users set blocked_at = null where id = ${OTHER_ID}`),
    ).rejects.toThrow();
  });

  it("la admin lista, busca y filtra", async () => {
    const all = await asUser(
      ADMIN_ID,
      (tx) => tx`select * from admin_people_list('panel', 'todas')`,
    );
    expect(all.map((r) => r.email).sort()).toEqual(Object.values(EMAILS).sort());
    expect(Number(all[0]!.total)).toBe(4);

    const byName = await asUser(
      ADMIN_ID,
      (tx) => tx`select * from admin_people_list('persona-panel')`,
    );
    expect(byName.map((r) => r.id)).toEqual([PERSON_ID]);

    const expiring = await asUser(
      ADMIN_ID,
      (tx) => tx`select id from admin_people_list('panel', 'vencen_7')`,
    );
    expect(expiring.map((r) => r.id)).toEqual([PERSON_ID]);

    const admins = await asUser(
      ADMIN_ID,
      (tx) => tx`select id from admin_people_list('panel', 'admins')`,
    );
    expect(admins.map((r) => r.id).sort()).toEqual([ADMIN_ID, ADMIN2_ID].sort());

    const sinOnb = await asUser(
      ADMIN_ID,
      (tx) => tx`select id from admin_people_list('panel', 'sin_onboarding')`,
    );
    expect(sinOnb.map((r) => r.id)).not.toContain(PERSON_ID);

    // Un comodín en la búsqueda se toma literal
    const literal = await asUser(
      ADMIN_ID,
      (tx) => tx`select id from admin_people_list('%', 'todas')`,
    );
    expect(literal.map((r) => r.id)).toEqual([]);
  });

  it("rol tester: lo da, no lo duplica, lo saca y lo anota; la persona lo ve con my_roles", async () => {
    expect(
      (
        (await one(
          ADMIN_ID,
          (tx) => tx`select admin_person_role(${PERSON_ID}, 'tester', true) as r`,
        )) as {
          r: string;
        }
      ).r,
    ).toBe("ok");
    expect(
      (
        (await one(
          ADMIN_ID,
          (tx) => tx`select admin_person_role(${PERSON_ID}, 'tester', true) as r`,
        )) as {
          r: string;
        }
      ).r,
    ).toBe("sin_cambio");
    expect(
      ((await one(PERSON_ID, (tx) => tx`select my_roles() as r`)) as { r: string[] }).r,
    ).toEqual(["tester"]);
    expect(
      ((await one(OTHER_ID, (tx) => tx`select my_roles() as r`)) as { r: string[] }).r,
    ).toEqual([]);
    const testers = await asUser(
      ADMIN_ID,
      (tx) => tx`select id from admin_people_list('panel', 'testers')`,
    );
    expect(testers.map((r) => r.id)).toEqual([PERSON_ID]);

    expect(
      (
        (await one(
          ADMIN_ID,
          (tx) => tx`select admin_person_role(${PERSON_ID}, 'tester', false) as r`,
        )) as {
          r: string;
        }
      ).r,
    ).toBe("ok");
    expect(
      ((await one(PERSON_ID, (tx) => tx`select my_roles() as r`)) as { r: string[] }).r,
    ).toEqual([]);
    await expect(
      asUser(ADMIN_ID, (tx) => tx`select admin_person_role(${PERSON_ID}, 'admin', true)`),
    ).rejects.toThrow(/rol desconocido/);
    expect(
      (
        (await one(
          ADMIN_ID,
          (tx) => tx`select admin_person_role(gen_random_uuid(), 'tester', true) as r`,
        )) as {
          r: string;
        }
      ).r,
    ).toBe("no_existe");
  });

  it("bloqueo: corta el login y la sesión; nunca a una admin ni a la propia cuenta", async () => {
    const block = async (id: string, on: boolean) =>
      (
        (await one(ADMIN_ID, (tx) => tx`select admin_person_block(${id}, ${on}) as r`)) as {
          r: string;
        }
      ).r;
    const [before] = await owner`select session_version from users where id = ${PERSON_ID}`;

    expect(await block(ADMIN_ID, true)).toBe("propia");
    expect(await block(ADMIN2_ID, true)).toBe("es_admin");
    expect(await block(PERSON_ID, true)).toBe("ok");
    expect(await block(PERSON_ID, true)).toBe("sin_cambio");

    const [after] =
      await owner`select session_version, blocked_at from users where id = ${PERSON_ID}`;
    expect(after!.blocked_at).not.toBeNull();
    expect(after!.session_version).toBe(before!.session_version + 1);
    const login = await asUser(
      OTHER_ID,
      (tx) => tx`select * from auth_user_by_email(${EMAILS[PERSON_ID]!})`,
    );
    expect(login).toEqual([]);
    const sv = await one(OTHER_ID, (tx) => tx`select user_session_version(${PERSON_ID}) as v`);
    expect((sv as { v: number | null }).v).toBeNull();

    expect(await block(PERSON_ID, false)).toBe("ok");
    expect(await block(PERSON_ID, false)).toBe("sin_cambio");
    const back = await asUser(
      OTHER_ID,
      (tx) => tx`select id from auth_user_by_email(${EMAILS[PERSON_ID]!})`,
    );
    expect(back.map((r) => r.id)).toEqual([PERSON_ID]);
  });

  it("cuenta de prueba y la ficha con el historial", async () => {
    expect(
      (
        (await one(ADMIN_ID, (tx) => tx`select admin_person_test(${OTHER_ID}, true) as r`)) as {
          r: string;
        }
      ).r,
    ).toBe("ok");
    const prueba = await asUser(
      ADMIN_ID,
      (tx) => tx`select id from admin_people_list('panel', 'prueba')`,
    );
    expect(prueba.map((r) => r.id)).toEqual([OTHER_ID]);

    const ficha = (await one(
      ADMIN_ID,
      (tx) => tx`select * from admin_person_get(${PERSON_ID})`,
    )) as {
      email: string;
      plan: string;
      onboarded: boolean;
      jobs: string;
    };
    expect(ficha.email).toBe(EMAILS[PERSON_ID]);
    expect(ficha.plan).toBe("lista");
    expect(ficha.onboarded).toBe(true);
    expect(Number(ficha.jobs)).toBe(0);

    const hist = await asUser(
      ADMIN_ID,
      (tx) => tx`select * from admin_person_history(${PERSON_ID})`,
    );
    expect(hist.map((h) => h.action)).toEqual([
      "desbloquear",
      "bloquear",
      "tester_no",
      "tester_si",
    ]);
    expect(hist.every((h) => h.admin_email === EMAILS[ADMIN_ID])).toBe(true);
  });

  it("la portada devuelve solo conteos", async () => {
    const r = (await one(ADMIN_ID, (tx) => tx`select admin_panel_summary() as s`)) as {
      s: Record<string, number>;
    };
    expect(Object.keys(r.s).sort()).toEqual(
      [
        "blocked",
        "expiring_7d",
        "feedback_new",
        "new_7d",
        "payment_notices",
        "people",
        "waitlist",
      ].sort(),
    );
    expect(r.s.expiring_7d).toBeGreaterThanOrEqual(1);
  });
});
