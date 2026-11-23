import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "./migrate";

/**
 * Cola de altas e historial del plan (R22-02, rls/0054_cola_de_altas.sql) por el camino real: la app como
 * jobsearch_app. Una cuenta común no lee la cola ni el historial ni puede usar las funciones; la admin
 * lista, activa y rechaza. Activar y rechazar son idempotentes: la segunda vez no cambia nada. Datos
 * inventados, con ids propios y limpieza al final.
 */
const APP_PASSWORD = "jobsearch_app_test";
const ADMIN_ID = "d9600000-0000-4000-8000-000000000001";
const PERSON_ID = "d9600000-0000-4000-8000-000000000002";
const OTHER_ID = "d9600000-0000-4000-8000-000000000003";
const OLD_ID = "d9600000-0000-4000-8000-000000000004";
const IDS = [ADMIN_ID, PERSON_ID, OTHER_ID, OLD_ID];
const EMAILS: Record<string, string> = {
  [ADMIN_ID]: "admin-cola@ejemplo.test",
  [PERSON_ID]: "persona-cola@ejemplo.test",
  [OTHER_ID]: "otra-cola@ejemplo.test",
  [OLD_ID]: "vieja-cola@ejemplo.test",
};
const UNTIL = () => new Date(Date.now() + 30 * 86_400_000).toISOString();
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

async function newNotice(userId: string): Promise<string> {
  const [row] = await owner`insert into payment_notices (user_id, plan, operation_number)
    values (${userId}, 'lista', '123456789') returning id`;
  return row!.id as string;
}

const firstNoticeId = async (userId: string) =>
  (
    await owner`select id from payment_notices where user_id = ${userId} order by created_at limit 1`
  )[0]!.id as string;
const noticeOf = async (id: string) =>
  (
    await owner`select status, reject_reason, resolved_at from payment_notices where id = ${id}`
  )[0]!;
const planOf = async (userId: string) =>
  (await owner`select plan, plan_source, plan_until from profiles where user_id = ${userId}`)[0]!;
const eventsOf = async (userId: string) =>
  await owner`select action, source, admin_id from plan_events where user_id = ${userId} order by created_at`;

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
    await owner`insert into profiles (user_id, display_name, location_country, inbound_address)
      values (${id}, 'Ficticio', 'AR', ${`u_cola_${id.slice(-4)}@ingest.test`}) on conflict (user_id) do nothing`;
  }
  await owner`update profiles set plan = 'fundador' where user_id = ${OLD_ID}`;
  await owner`insert into app_admins (user_id) values (${ADMIN_ID}) on conflict do nothing`;
  await owner`delete from payment_notices where user_id in ${owner(IDS)}`;
  await owner`delete from plan_events where user_id in ${owner(IDS)}`;
}, 180_000);

afterAll(async () => {
  if (owner) {
    await owner`delete from payment_notices where user_id in ${owner(IDS)}`;
    await owner`delete from plan_events where user_id in ${owner(IDS)}`;
    await owner`delete from app_admins where user_id = ${ADMIN_ID}`;
    await owner`delete from users where id in ${owner(IDS)}`;
  }
  await app?.end();
  await owner?.end();
  await container?.stop();
});

describe("cola de altas: una cuenta común no entra", () => {
  it("no lee la cola, el historial ni las tablas directamente", async () => {
    const id = await newNotice(PERSON_ID);
    await expect(
      asUser(PERSON_ID, (tx) => tx`select * from admin_payment_notice_list(10)`),
    ).rejects.toThrow(DENIED);
    await expect(
      asUser(PERSON_ID, (tx) => tx`select * from admin_plan_event_list(10)`),
    ).rejects.toThrow(DENIED);
    // La persona sigue viendo su propio aviso (0053), pero no el de otra
    expect(await asUser(PERSON_ID, (tx) => tx`select id from payment_notices`)).toHaveLength(1);
    await expect(asUser(PERSON_ID, (tx) => tx`select 1 from plan_events`)).rejects.toThrow(
      /permission denied/,
    );
    expect(await noticeOf(id)).toMatchObject({ status: "pendiente" });
  });

  it("no puede activar, rechazar ni anotar eventos con las funciones", async () => {
    const id = await firstNoticeId(PERSON_ID);
    await expect(
      asUser(
        PERSON_ID,
        (tx) => tx`select admin_payment_notice_activate(${id}::uuid, ${UNTIL()}::timestamptz)`,
      ),
    ).rejects.toThrow(DENIED);
    await expect(
      asUser(PERSON_ID, (tx) => tx`select admin_payment_notice_reject(${id}::uuid, 'no')`),
    ).rejects.toThrow(DENIED);
    await expect(
      asUser(
        PERSON_ID,
        (tx) => tx`select admin_plan_event_add(${EMAILS[PERSON_ID]!}, 'activar', 'pago')`,
      ),
    ).rejects.toThrow(DENIED);
    expect(await noticeOf(id)).toMatchObject({ status: "pendiente" });
    expect((await planOf(PERSON_ID)).plan).toBe("gratis");
    expect(await eventsOf(PERSON_ID)).toHaveLength(0);
  });
});

describe("cola de altas: lo que hace la admin", () => {
  it("lista los pendientes con email, plan y número de operación", async () => {
    await newNotice(OTHER_ID);
    const rows = await asUser(ADMIN_ID, (tx) => tx`select * from admin_payment_notice_list(100)`);
    const emails = rows.map((r) => r.email);
    expect(emails).toContain(EMAILS[PERSON_ID]);
    expect(emails).toContain(EMAILS[OTHER_ID]);
    expect(rows.find((r) => r.email === EMAILS[PERSON_ID])).toMatchObject({
      plan: "lista",
      operation_number: "123456789",
    });
  });

  it("activar da el plan como pago, marca el aviso y deja el historial", async () => {
    const id = await firstNoticeId(PERSON_ID);
    const [res] = await asUser(
      ADMIN_ID,
      (tx) => tx`select admin_payment_notice_activate(${id}::uuid, ${UNTIL()}::timestamptz) as r`,
    );
    expect(res!.r).toBe("ok");
    expect(await planOf(PERSON_ID)).toMatchObject({ plan: "lista", plan_source: "pago" });
    expect(await noticeOf(id)).toMatchObject({ status: "activado" });
    expect((await noticeOf(id)).resolved_at).not.toBeNull();
    expect(await eventsOf(PERSON_ID)).toEqual([
      { action: "activar", source: "pago", admin_id: ADMIN_ID },
    ]);
    const pending = await asUser(
      ADMIN_ID,
      (tx) => tx`select id from admin_payment_notice_list(100)`,
    );
    expect(pending.map((r) => r.id)).not.toContain(id);
  });

  it("activar dos veces no suma días ni repite el historial (idempotente)", async () => {
    const id = await firstNoticeId(PERSON_ID);
    const before = (await planOf(PERSON_ID)).plan_until;
    const [res] = await asUser(
      ADMIN_ID,
      (tx) =>
        tx`select admin_payment_notice_activate(${id}::uuid, ${new Date(Date.now() + 90 * 86_400_000).toISOString()}::timestamptz) as r`,
    );
    expect(res!.r).toBe("ya_resuelto");
    expect((await planOf(PERSON_ID)).plan_until).toEqual(before);
    expect(await eventsOf(PERSON_ID)).toHaveLength(1);
  });

  it("dos activaciones a la vez: solo una pasa", async () => {
    const id = await newNotice(OTHER_ID);
    const run = () =>
      asUser(
        ADMIN_ID,
        (tx) => tx`select admin_payment_notice_activate(${id}::uuid, ${UNTIL()}::timestamptz) as r`,
      );
    const results = (await Promise.all([run(), run()])).map((r) => r[0]!.r as string).sort();
    expect(results).toEqual(["ok", "ya_resuelto"]);
    expect((await eventsOf(OTHER_ID)).filter((e) => e.action === "activar")).toHaveLength(1);
  });

  it("rechazar guarda el motivo, anota el historial y no cambia el plan", async () => {
    const id = await newNotice(PERSON_ID);
    const [res] = await asUser(
      ADMIN_ID,
      (tx) => tx`select admin_payment_notice_reject(${id}::uuid, '  No vimos el pago  ') as r`,
    );
    expect(res!.r).toBe("ok");
    expect(await noticeOf(id)).toMatchObject({
      status: "rechazado",
      reject_reason: "No vimos el pago",
    });
    expect((await eventsOf(PERSON_ID)).map((e) => e.action)).toContain("rechazar_aviso");
  });

  it("rechazar dos veces conserva el primer motivo; un motivo vacío o largo se rechaza", async () => {
    const id = await newNotice(OTHER_ID);
    const reject = (reason: string) =>
      asUser(ADMIN_ID, (tx) => tx`select admin_payment_notice_reject(${id}::uuid, ${reason}) as r`);
    expect((await reject("   "))[0]!.r).toBe("motivo_invalido");
    expect((await reject("x".repeat(201)))[0]!.r).toBe("motivo_invalido");
    expect((await reject("Primero"))[0]!.r).toBe("ok");
    expect((await reject("Segundo"))[0]!.r).toBe("ya_resuelto");
    expect((await noticeOf(id)).reject_reason).toBe("Primero");
  });

  it("un aviso que no existe devuelve no_existe", async () => {
    const [res] = await asUser(
      ADMIN_ID,
      (tx) =>
        tx`select admin_payment_notice_reject('00000000-0000-4000-8000-00000000dead'::uuid, 'x') as r`,
    );
    expect(res!.r).toBe("no_existe");
  });

  it("con un plan viejo no activa y el aviso sigue pendiente", async () => {
    const id = await newNotice(OLD_ID);
    const [res] = await asUser(
      ADMIN_ID,
      (tx) => tx`select admin_payment_notice_activate(${id}::uuid, ${UNTIL()}::timestamptz) as r`,
    );
    expect(res!.r).toBe("plan_viejo");
    expect(await noticeOf(id)).toMatchObject({ status: "pendiente" });
    expect((await planOf(OLD_ID)).plan).toBe("fundador");
  });
});

describe("historial del plan", () => {
  it("la admin anota y lee los cambios, con email solo en la lectura", async () => {
    await asUser(
      ADMIN_ID,
      (tx) => tx`select admin_plan_event_add(${EMAILS[OLD_ID]!.toUpperCase()}, 'quitar', null)`,
    );
    const rows = await asUser(ADMIN_ID, (tx) => tx`select * from admin_plan_event_list(50)`);
    expect(rows.find((r) => r.email === EMAILS[OLD_ID] && r.action === "quitar")).toBeTruthy();
    const cols = await owner`select column_name from information_schema.columns
      where table_name = 'plan_events' and column_name ilike '%email%'`;
    expect(cols).toHaveLength(0);
  });

  it("la base solo acepta las acciones de la lista (CHECK)", async () => {
    await expect(
      owner`insert into plan_events (user_id, action) values (${OLD_ID}, 'regalar')`,
    ).rejects.toThrow(/plan_events_action/);
  });

  it("al borrar la cuenta el historial cae por cascade", async () => {
    const id = "d9600000-0000-4000-8000-0000000000aa";
    await owner`insert into users (id, email, name) values (${id}, 'cascada-cola@ejemplo.test', 'Ficticio')`;
    await owner`insert into plan_events (user_id, action) values (${id}, 'activar')`;
    await owner`delete from users where id = ${id}`;
    expect(await eventsOf(id)).toHaveLength(0);
  });
});
