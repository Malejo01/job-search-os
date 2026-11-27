import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "./migrate";

/**
 * Apertura por carrera (R32-03) y baja del email de novedades (R32-09), rls/0074, por el camino real: la app como
 * jobsearch_app. Datos inventados.
 */
const APP_PASSWORD = "jobsearch_app_test";
const ADMIN = "e3200000-0000-4000-8000-0000000000a1";
const COMUN = "e3200000-0000-4000-8000-0000000000a2";
const OTRA = "e3200000-0000-4000-8000-0000000000a3";

let container: StartedPostgreSqlContainer | null = null;
let owner: Sql;
let app: Sql;

async function asUser<T>(userId: string | null, fn: (tx: Sql) => Promise<T>): Promise<T> {
  return (await app.begin(async (tx) => {
    if (userId) await tx`select set_config('app.user_id', ${userId}, true)`;
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
  owner = postgres(ownerUrl, { max: 6, prepare: false });
  await owner.unsafe(`ALTER ROLE jobsearch_app WITH PASSWORD '${APP_PASSWORD}'`);
  const u = new URL(ownerUrl);
  u.username = "jobsearch_app";
  u.password = APP_PASSWORD;
  app = postgres(u.toString(), { max: 4, prepare: false });
  for (const [id, email] of [
    [ADMIN, "admin-apertura@ejemplo.test"],
    [COMUN, "comun-apertura@ejemplo.test"],
    [OTRA, "otra-apertura@ejemplo.test"],
  ] as const) {
    await owner`insert into users (id, email, name) values (${id}, ${email}, 'Ficticio') on conflict (id) do nothing`;
  }
  await owner`insert into app_admins (user_id) values (${ADMIN}) on conflict do nothing`;
  for (const [id, address] of [
    [COMUN, "u_aaaaaaaaaaaaaaaaaaab@ingest.ejemplo.test"],
    [OTRA, "u_aaaaaaaaaaaaaaaaaaac@ingest.ejemplo.test"],
  ] as const) {
    await owner`insert into profiles (user_id, display_name, location_country, inbound_address)
                values (${id}, 'Ficticio', 'AR', ${address})
                on conflict (user_id) do nothing`;
  }
}, 180_000);

afterAll(async () => {
  if (owner) {
    await owner`delete from open_careers`;
    await owner`delete from career_opening_events`;
    await owner`delete from profiles where user_id in ${owner([COMUN, OTRA])}`;
    await owner`delete from app_admins where user_id = ${ADMIN}`;
    await owner`delete from users where id in ${owner([ADMIN, COMUN, OTRA])}`;
    await owner.end();
  }
  await app?.end();
  await container?.stop();
});

describe("carreras abiertas (rls/0074)", () => {
  it("las dos tablas tienen RLS forzado y la app no las toca directo", async () => {
    const rows = await owner<{ relname: string; rls: boolean; force: boolean }[]>`
      select relname, relrowsecurity as rls, relforcerowsecurity as force from pg_class
      where relname in ('open_careers', 'career_opening_events') order by relname`;
    expect(rows).toEqual([
      { relname: "career_opening_events", rls: true, force: true },
      { relname: "open_careers", rls: true, force: true },
    ]);
    await expect(asUser(ADMIN, (tx) => tx`select * from open_careers`)).rejects.toThrow();
    await expect(
      asUser(ADMIN, (tx) => tx`insert into open_careers (career) values ('abogacia')`),
    ).rejects.toThrow();
    await expect(asUser(ADMIN, (tx) => tx`select * from career_opening_events`)).rejects.toThrow();
  });

  it("la lista arranca vacía y la lee cualquiera, incluso sin sesión", async () => {
    const [sinSesion] = await asUser(
      null,
      (tx) => tx<{ l: string[] }[]>`select careers_open_list() as l`,
    );
    expect(sinSesion!.l).toEqual([]);
    const [comun] = await asUser(
      COMUN,
      (tx) => tx<{ l: string[] }[]>`select careers_open_list() as l`,
    );
    expect(comun!.l).toEqual([]);
  });

  it("una persona común no puede cambiarla ni ver el historial", async () => {
    await expect(
      asUser(COMUN, (tx) => tx`select admin_career_set('abogacia', true)`),
    ).rejects.toThrow(/no autorizado/);
    await expect(asUser(COMUN, (tx) => tx`select * from admin_career_history(10)`)).rejects.toThrow(
      /no autorizado/,
    );
    await expect(asUser(COMUN, (tx) => tx`select * from admin_careers_open()`)).rejects.toThrow(
      /no autorizado/,
    );
    await expect(
      asUser(null, (tx) => tx`select admin_career_set('abogacia', true)`),
    ).rejects.toThrow(/no autorizado/);
  });

  it("un admin abre y cierra; cada cambio real queda con quién y cuándo, y repetir no escribe", async () => {
    const set = async (career: string, open: boolean) => {
      const [r] = await asUser(
        ADMIN,
        (tx) => tx<{ s: string }[]>`select admin_career_set(${career}, ${open}) as s`,
      );
      return r!.s;
    };
    expect(await set("abogacia", true)).toBe("ok");
    expect(await set("abogacia", true)).toBe("sin_cambio");
    expect(await set("comunicacion", true)).toBe("ok");
    expect(await set("comunicacion", false)).toBe("ok");
    expect(await set("comunicacion", false)).toBe("sin_cambio");
    expect(await set("Con Espacios", true)).toBe("invalida");
    expect(await set("", true)).toBe("invalida");

    const [abiertas] = await asUser(
      COMUN,
      (tx) => tx<{ l: string[] }[]>`select careers_open_list() as l`,
    );
    expect(abiertas!.l).toEqual(["abogacia"]);

    const historial = await asUser(
      ADMIN,
      (tx) =>
        tx<{ career: string; action: string; admin_email: string; created_at: Date }[]>`
          select * from admin_career_history(10)`,
    );
    expect(historial.map((h) => `${h.career}:${h.action}`).sort()).toEqual([
      "abogacia:abrir",
      "comunicacion:abrir",
      "comunicacion:cerrar",
    ]);
    expect(historial.every((h) => h.admin_email === "admin-apertura@ejemplo.test")).toBe(true);
    expect(historial.every((h) => h.created_at instanceof Date)).toBe(true);

    const abiertasAdmin = await asUser(
      ADMIN,
      (tx) => tx<{ career: string; opened_by_email: string }[]>`select * from admin_careers_open()`,
    );
    expect(abiertasAdmin.map((a) => a.career)).toEqual(["abogacia"]);
    expect(abiertasAdmin[0]!.opened_by_email).toBe("admin-apertura@ejemplo.test");
  });

  it("dos cambios simultáneos de la misma carrera escriben un solo evento", async () => {
    const [a, b] = await Promise.all([
      asUser(ADMIN, (tx) => tx<{ s: string }[]>`select admin_career_set('fullstack', true) as s`),
      asUser(ADMIN, (tx) => tx<{ s: string }[]>`select admin_career_set('fullstack', true) as s`),
    ]);
    expect([a[0]!.s, b[0]!.s].sort()).toEqual(["ok", "sin_cambio"]);
    const [n] = await owner<{ n: number }[]>`
      select count(*)::int as n from career_opening_events where career = 'fullstack'`;
    expect(n!.n).toBe(1);
  });

  it("si se borra la cuenta del admin, la lista y el historial siguen (quién queda en null)", async () => {
    const otro = "e3200000-0000-4000-8000-0000000000a4";
    await owner`insert into users (id, email, name) values (${otro}, 'otro-admin-apertura@ejemplo.test', 'Ficticio')`;
    await owner`insert into app_admins (user_id) values (${otro})`;
    await asUser(otro, (tx) => tx`select admin_career_set('marketing_digital', true)`);
    await owner`delete from app_admins where user_id = ${otro}`;
    await owner`delete from users where id = ${otro}`;
    const [l] = await asUser(COMUN, (tx) => tx<{ l: string[] }[]>`select careers_open_list() as l`);
    expect(l!.l).toContain("marketing_digital");
    const [e] = await owner<{ admin_id: string | null }[]>`
      select admin_id from career_opening_events where career = 'marketing_digital'`;
    expect(e!.admin_id).toBeNull();
  });
});

describe("baja del email de novedades (rls/0074)", () => {
  it("por defecto está prendido y la baja sin sesión lo apaga solo para esa persona", async () => {
    const antes = await owner<{ user_id: string; news_email: boolean }[]>`
      select user_id, news_email from profiles where user_id in ${owner([COMUN, OTRA])}`;
    expect(antes.every((p) => p.news_email === true)).toBe(true);

    // Solo la conexión de servicio (la ruta de baja, después de verificar la firma): la app no tiene EXECUTE
    const [r] = await owner<{ ok: boolean }[]>`select news_email_unsubscribe(${COMUN}::uuid) as ok`;
    expect(r!.ok).toBe(true);
    // idempotente
    const [r2] = await owner<
      { ok: boolean }[]
    >`select news_email_unsubscribe(${COMUN}::uuid) as ok`;
    expect(r2!.ok).toBe(true);

    const despues = await owner<{ user_id: string; news_email: boolean }[]>`
      select user_id, news_email from profiles where user_id in ${owner([COMUN, OTRA])}`;
    expect(despues.find((p) => p.user_id === COMUN)!.news_email).toBe(false);
    expect(despues.find((p) => p.user_id === OTRA)!.news_email).toBe(true);
  });

  it("responde lo mismo exista o no la cuenta (sin oráculo de existencia)", async () => {
    const [r] = await owner<
      { ok: boolean }[]
    >`select news_email_unsubscribe('e3200000-0000-4000-8000-0000000000ff'::uuid) as ok`;
    expect(r!.ok).toBe(true);
  });

  it("la app no puede ejecutarla: ni con sesión ni sin ella, ni sobre otra persona", async () => {
    for (const quien of [null, COMUN]) {
      await expect(
        asUser(quien, (tx) => tx`select news_email_unsubscribe(${OTRA}::uuid)`),
      ).rejects.toThrow(/permission denied/);
    }
    const [p] = await owner<
      { news_email: boolean }[]
    >`select news_email from profiles where user_id = ${OTRA}`;
    expect(p!.news_email).toBe(true);
  });

  it("la persona puede volver a prender su preferencia desde su perfil (RLS del dueño)", async () => {
    await asUser(COMUN, (tx) => tx`update profiles set news_email = true where user_id = ${COMUN}`);
    const [p] = await owner<
      { news_email: boolean }[]
    >`select news_email from profiles where user_id = ${COMUN}`;
    expect(p!.news_email).toBe(true);
  });
});

describe("columnas que la persona no escribe y recuadro de la carrera (rls/0074)", () => {
  const reset = async () =>
    owner`update profiles set target_roles = '{}', target_role = null, career_other = null,
            career_asked_at = null, news_email_sent_at = null where user_id in ${owner([COMUN, OTRA])}`;

  it("la persona no escribe career_asked_at ni news_email_sent_at, pero sí career_other y news_email", async () => {
    await reset();
    await expect(
      asUser(
        COMUN,
        (tx) => tx`update profiles set career_asked_at = now() where user_id = ${COMUN}`,
      ),
    ).rejects.toThrow(/esas columnas las escribe el servidor/);
    await expect(
      asUser(
        COMUN,
        (tx) => tx`update profiles set news_email_sent_at = now() where user_id = ${COMUN}`,
      ),
    ).rejects.toThrow(/esas columnas las escribe el servidor/);
    await asUser(
      COMUN,
      (tx) =>
        tx`update profiles set career_other = 'Arquitectura', news_email = false where user_id = ${COMUN}`,
    );
    const [p] = await owner<{ career_other: string; news_email: boolean }[]>`
      select career_other, news_email from profiles where user_id = ${COMUN}`;
    expect(p).toEqual({ career_other: "Arquitectura", news_email: false });
    // El dueño (el cron) sí
    await owner`update profiles set news_email_sent_at = now() where user_id = ${COMUN}`;
    await reset();
  });

  it("career_prompt_save guarda la carrera y anota que se pidió", async () => {
    await reset();
    const [r] = await asUser(
      COMUN,
      (tx) =>
        tx<
          { ok: boolean }[]
        >`select career_prompt_save('{abogacia}'::text[], null, '{}'::text[]) as ok`,
    );
    expect(r!.ok).toBe(true);
    const [p] = await owner<{ target_roles: string[]; target_role: string; asked: Date | null }[]>`
      select target_roles, target_role, career_asked_at as asked from profiles where user_id = ${COMUN}`;
    expect(p!.target_roles).toEqual(["abogacia"]);
    expect(p!.target_role).toBe("abogacia");
    expect(p!.asked).not.toBeNull();
  });

  it("no pisa una carrera cargada en otra pestaña, y acepta claves viejas si coinciden con lo leído", async () => {
    await reset();
    await owner`update profiles set target_roles = '{producto_proyectos}' where user_id = ${COMUN}`;
    const [stale] = await asUser(
      COMUN,
      (tx) =>
        tx<
          { ok: boolean }[]
        >`select career_prompt_save('{fullstack}'::text[], null, '{}'::text[]) as ok`,
    );
    expect(stale!.ok).toBe(false);
    const [fresh] = await asUser(
      COMUN,
      (tx) =>
        tx<
          { ok: boolean }[]
        >`select career_prompt_save('{fullstack}'::text[], null, '{producto_proyectos}'::text[]) as ok`,
    );
    expect(fresh!.ok).toBe(true);
    await reset();
  });

  it("«Otra» se guarda sin puestos; sin sesión no escribe nada", async () => {
    await reset();
    const [r] = await asUser(
      COMUN,
      (tx) =>
        tx<
          { ok: boolean }[]
        >`select career_prompt_save('{}'::text[], 'Arquitectura', '{}'::text[]) as ok`,
    );
    expect(r!.ok).toBe(true);
    const [none] = await asUser(
      null,
      (tx) =>
        tx<
          { ok: boolean }[]
        >`select career_prompt_save('{abogacia}'::text[], null, '{}'::text[]) as ok`,
    );
    expect(none!.ok).toBe(false);
    await reset();
  });

  it("career_prompt_dismiss anota que se pidió una sola vez y solo en la fila propia", async () => {
    await reset();
    const [a] = await asUser(
      COMUN,
      (tx) => tx<{ ok: boolean }[]>`select career_prompt_dismiss() as ok`,
    );
    expect(a!.ok).toBe(true);
    const [b] = await asUser(
      COMUN,
      (tx) => tx<{ ok: boolean }[]>`select career_prompt_dismiss() as ok`,
    );
    expect(b!.ok).toBe(false);
    const rows = await owner<{ user_id: string; asked: Date | null }[]>`
      select user_id, career_asked_at as asked from profiles where user_id in ${owner([COMUN, OTRA])}`;
    expect(rows.find((x) => x.user_id === COMUN)!.asked).not.toBeNull();
    expect(rows.find((x) => x.user_id === OTRA)!.asked).toBeNull();
    await reset();
  });

  it("«otra» nunca se puede abrir como carrera", async () => {
    const [r] = await asUser(
      ADMIN,
      (tx) => tx<{ s: string }[]>`select admin_career_set('otra', true) as s`,
    );
    expect(r!.s).toBe("invalida");
  });
});
