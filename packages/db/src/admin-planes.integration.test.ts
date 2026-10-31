import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "./migrate";

/**
 * Planes desde el panel de admin (C3-1, rls/0015_admin_planes.sql) por el camino real: la app como
 * jobsearch_app. Solo una cuenta de app_admins activa, quita o lista planes; los demás reciben «no
 * autorizado»; la base acota origen, fecha y plan. Datos inventados.
 */
const APP_PASSWORD = "jobsearch_app_test";
const ADMIN_ID = "d9300000-0000-4000-8000-000000000001";
const PERSON_ID = "d9300000-0000-4000-8000-000000000002";
const NO_PROFILE_ID = "d9300000-0000-4000-8000-000000000003";
const IDS = [ADMIN_ID, PERSON_ID, NO_PROFILE_ID];
const PERSON_EMAIL = "persona-plan@ejemplo.test";
const NO_PROFILE_EMAIL = "sin-perfil-plan@ejemplo.test";
const DENIED = /admin_plan: no autorizado/;

let container: StartedPostgreSqlContainer | null = null;
let owner: Sql;
let app: Sql;

async function asUser<T>(userId: string, run: (tx: Sql) => Promise<T>): Promise<T> {
  return (await app.begin(async (tx) => {
    await tx`select set_config('app.user_id', ${userId}, true)`;
    return run(tx as unknown as Sql);
  })) as T;
}

const in30Days = () => new Date(Date.now() + 30 * 86_400_000);

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
  app = postgres(u.toString(), { max: 2, prepare: false });
  const emails = ["admin-plan@ejemplo.test", PERSON_EMAIL, NO_PROFILE_EMAIL];
  for (const [i, id] of IDS.entries()) {
    await owner`insert into users (id, email, name) values (${id}, ${emails[i]!}, 'Ficticio')
      on conflict (id) do nothing`;
  }
  for (const [id, inbound] of [
    [ADMIN_ID, "adminplan01"],
    [PERSON_ID, "adminplan02"],
  ] as const) {
    await owner`insert into profiles (user_id, display_name, location_country, inbound_address)
      values (${id}, 'Ficticio', 'AR', ${inbound}) on conflict (user_id) do nothing`;
  }
  await owner`insert into app_admins (user_id) values (${ADMIN_ID}) on conflict do nothing`;
}, 180_000);

afterAll(async () => {
  if (owner) {
    await owner`delete from app_admins where user_id = ${ADMIN_ID}`;
    await owner`delete from profiles where user_id in ${owner(IDS)}`;
    await owner`delete from users where id in ${owner(IDS)}`;
  }
  await app?.end();
  await owner?.end();
  await container?.stop();
});

describe("planes desde el panel de admin (C3-1)", () => {
  it("una cuenta que no es admin no lee, lista ni cambia planes", async () => {
    await expect(
      asUser(PERSON_ID, (tx) => tx`select * from admin_plan_get(${PERSON_EMAIL})`),
    ).rejects.toThrow(DENIED);
    await expect(asUser(PERSON_ID, (tx) => tx`select * from admin_plan_list(10)`)).rejects.toThrow(
      DENIED,
    );
    await expect(
      asUser(
        PERSON_ID,
        (tx) =>
          tx`select * from admin_plan_set(${PERSON_EMAIL}, 'lista', 'pago', ${in30Days()}::timestamptz)`,
      ),
    ).rejects.toThrow(DENIED);
    const [row] = await owner`select plan from profiles where user_id = ${PERSON_ID}`;
    expect(row?.plan).toBe("gratis");
  });

  it("el admin activa 30 días como pago y la fila queda con plan, origen y fecha", async () => {
    const until = in30Days();
    const rows = await asUser(
      ADMIN_ID,
      (tx) =>
        tx`select * from admin_plan_set(${PERSON_EMAIL.toUpperCase()}, 'lista', 'pago', ${until}::timestamptz)`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ plan: "lista", plan_source: "pago" });
    expect(new Date(rows[0]!.plan_until as string).getTime()).toBe(until.getTime());
    const [saved] =
      await owner`select plan, plan_source from profiles where user_id = ${PERSON_ID}`;
    expect(saved).toEqual({ plan: "lista", plan_source: "pago" });
  });

  it("marca a un becado y la lista lo muestra con su origen", async () => {
    await asUser(
      ADMIN_ID,
      (tx) =>
        tx`select * from admin_plan_set(${PERSON_EMAIL}, 'lista', 'beca', ${in30Days()}::timestamptz)`,
    );
    const got = await asUser(ADMIN_ID, (tx) => tx`select * from admin_plan_get(${PERSON_EMAIL})`);
    expect(got[0]).toMatchObject({ plan: "lista", plan_source: "beca" });
    const list = await asUser(ADMIN_ID, (tx) => tx`select * from admin_plan_list(50)`);
    expect(list.find((r) => r.email === PERSON_EMAIL)).toMatchObject({ plan_source: "beca" });
    // Nadie sin plan pago aparece
    expect(list.find((r) => r.email === "admin-plan@ejemplo.test")).toBeUndefined();
  });

  it("la base acota el origen, la fecha y el plan", async () => {
    const set = (args: [string, string | null, Date | null]) =>
      asUser(
        ADMIN_ID,
        (tx) =>
          tx`select * from admin_plan_set(${PERSON_EMAIL}, ${args[0]}, ${args[1]}, ${args[2]}::timestamptz)`,
      );
    await expect(set(["lista", "regalo", in30Days()])).rejects.toThrow(/origen/);
    await expect(set(["lista", "pago", new Date(Date.now() - 86_400_000)])).rejects.toThrow(
      /fecha de fin/,
    );
    await expect(set(["lista", "pago", new Date(Date.now() + 500 * 86_400_000)])).rejects.toThrow(
      /fecha de fin/,
    );
    await expect(set(["fundador", "pago", in30Days()])).rejects.toThrow(/plan no permitido/);
    await expect(set(["gratis", "pago", null])).rejects.toThrow(/gratis no lleva/);
  });

  it("quitar el plan lo deja en gratis, sin origen ni fecha, y conserva el perfil", async () => {
    const rows = await asUser(
      ADMIN_ID,
      (tx) => tx`select * from admin_plan_set(${PERSON_EMAIL}, 'gratis', null, null)`,
    );
    expect(rows[0]).toEqual({ plan: "gratis", plan_source: null, plan_until: null });
    const [saved] = await owner`select display_name from profiles where user_id = ${PERSON_ID}`;
    expect(saved?.display_name).toBe("Ficticio");
  });

  it("una persona que no existe, o que no terminó el onboarding, no devuelve fila", async () => {
    const none = await asUser(
      ADMIN_ID,
      (tx) =>
        tx`select * from admin_plan_set('nadie@ejemplo.test', 'lista', 'pago', ${in30Days()}::timestamptz)`,
    );
    expect(none).toHaveLength(0);
    const noProfile = await asUser(
      ADMIN_ID,
      (tx) =>
        tx`select * from admin_plan_set(${NO_PROFILE_EMAIL}, 'lista', 'pago', ${in30Days()}::timestamptz)`,
    );
    expect(noProfile).toHaveLength(0);
  });

  it("la app sigue sin poder cambiarse el plan sola, aunque sea la cuenta admin", async () => {
    await expect(
      asUser(ADMIN_ID, (tx) => tx`update profiles set plan = 'lista' where user_id = ${ADMIN_ID}`),
    ).rejects.toThrow(/profiles_plan_guard/);
  });
});
