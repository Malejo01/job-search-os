import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "./migrate";

/**
 * «Mi informe de revisión» (R29-02, rls/0069) por el camino real: la app como jobsearch_app. La persona arma su
 * informe y lo ve solo ella; al enviarlo queda congelado; el admin lee lo enviado por las funciones, sin email ni
 * nombre y sin borradores; borrar la cuenta se lleva las cuatro tablas. Datos inventados.
 */
const APP_PASSWORD = "jobsearch_app_test";
const ADMIN_ID = "e2900000-0000-4000-8000-0000000000aa";
const A = "e2900000-0000-4000-8000-000000000001";
const B = "e2900000-0000-4000-8000-000000000002";
const ALL = [ADMIN_ID, A, B];
const SHA = "b".repeat(64);

let container: StartedPostgreSqlContainer | null = null;
let owner: Sql;
let app: Sql;

async function asUser<T>(userId: string, fn: (tx: Sql) => Promise<T>): Promise<T> {
  return (await app.begin(async (tx) => {
    await tx`select set_config('app.user_id', ${userId}, true)`;
    return fn(tx as unknown as Sql);
  })) as T;
}

const newReport = (as: string, ownerOfRow = as, status = "borrador") =>
  asUser(
    as,
    (tx) => tx<{ id: string }[]>`insert into feedback_reports (user_id, status, sent_at)
      values (${ownerOfRow}, ${status}, ${status === "borrador" ? null : new Date()}) returning id`,
  ).then((r) => r[0]!.id);

const newItem = (
  as: string,
  reportId: string,
  position = 0,
  extra: { ownerOfRow?: string; status?: string; message?: string; category?: string } = {},
) =>
  asUser(
    as,
    (tx) => tx<{ id: string }[]>`insert into feedback_items
      (report_id, user_id, position, path, category, message, status)
      values (${reportId}, ${extra.ownerOfRow ?? as}, ${position}, '/hoy', ${extra.category ?? "idea"},
              ${extra.message ?? "Ítem ficticio"}, ${extra.status ?? "nuevo"}) returning id`,
  ).then((r) => r[0]!.id);

const newAttachment = (as: string, itemId: string, kind = "image", ownerOfRow = as) =>
  asUser(
    as,
    (tx) => tx<{ id: string }[]>`insert into feedback_attachments
      (user_id, item_id, original_name, kind, mime, bytes, sha256, width, height)
      values (${ownerOfRow}, ${itemId}, 'archivo.bin', ${kind}, 'application/octet-stream', 4, ${SHA},
              ${kind === "image" ? 10 : null}, ${kind === "image" ? 10 : null}) returning id`,
  ).then((r) => r[0]!.id);

const newBlob = (as: string, ownerOfRow = as) =>
  asUser(
    as,
    (tx) => tx<{ id: string }[]>`insert into blob_files (user_id, content_type, bytes, sha256, data)
      values (${ownerOfRow}, 'image/webp', 4, ${SHA}, decode('01020304', 'hex')) returning id`,
  ).then((r) => r[0]!.id);

const send = (as: string, reportId: string) =>
  asUser(
    as,
    (tx) => tx`update feedback_reports set status = 'enviado', sent_at = now(), updated_at = now()
               where id = ${reportId}`,
  );

async function cleanAll() {
  await owner`delete from blob_files where user_id in ${owner(ALL)}`;
  await owner`delete from feedback_reports where user_id in ${owner(ALL)}`;
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
  }
  await owner`insert into app_admins (user_id) values (${ADMIN_ID}) on conflict do nothing`;
}, 180_000);

afterAll(async () => {
  if (owner) {
    await cleanAll();
    await owner`delete from app_admins where user_id = ${ADMIN_ID}`;
    await owner`delete from users where id in ${owner(ALL)}`;
  }
  await app?.end();
  await owner?.end();
  await container?.stop();
});

describe("aislamiento por persona", () => {
  it("B no ve nada de lo de A: informe, ítems, adjuntos ni archivos", async () => {
    await cleanAll();
    const report = await newReport(A);
    const item = await newItem(A, report);
    await newAttachment(A, item);
    await newBlob(A);
    for (const table of [
      "feedback_reports",
      "feedback_items",
      "feedback_attachments",
      "blob_files",
    ]) {
      const mine = await asUser(A, (tx) => tx.unsafe(`select 1 from ${table}`));
      expect(mine.length, `${table} de A`).toBe(1);
      const other = await asUser(B, (tx) => tx.unsafe(`select 1 from ${table}`));
      expect(other.length, `${table} visto por B`).toBe(0);
    }
  });

  it("B no cambia ni borra lo de A", async () => {
    const [r] = await owner<{ id: string }[]>`select id from feedback_reports where user_id = ${A}`;
    const upd = await asUser(
      B,
      (tx) => tx`update feedback_reports set updated_at = now() where id = ${r!.id}`,
    );
    expect(upd.count).toBe(0);
    const del = await asUser(B, (tx) => tx`delete from feedback_items where report_id = ${r!.id}`);
    expect(del.count).toBe(0);
    const delBlob = await asUser(B, (tx) => tx`delete from blob_files`);
    expect(delBlob.count).toBe(0);
  });

  it("nadie inserta a nombre de otra persona ni cuelga un ítem del informe de otra", async () => {
    await expect(newReport(B, A)).rejects.toThrow(/row-level security/);
    const [r] = await owner<{ id: string }[]>`select id from feedback_reports where user_id = ${A}`;
    await expect(newItem(B, r!.id, 5)).rejects.toThrow(/row-level security/);
    const [i] = await owner<{ id: string }[]>`select id from feedback_items where user_id = ${A}`;
    await expect(newAttachment(B, i!.id)).rejects.toThrow(/row-level security/);
    await expect(newBlob(B, A)).rejects.toThrow(/row-level security/);
  });
});

describe("el borrador se edita y el enviado queda como se mandó", () => {
  it("una persona tiene un solo borrador a la vez", async () => {
    await expect(newReport(A)).rejects.toThrow(/feedback_reports_one_draft/);
  });

  it("no se crea un informe ya enviado ni con estado de admin", async () => {
    await cleanAll();
    await expect(newReport(A, A, "enviado")).rejects.toThrow(/row-level security/);
    await expect(newReport(A, A, "visto")).rejects.toThrow(/row-level security/);
  });

  it("la persona no se pone a sí misma visto ni resuelto, ni en el informe ni en los ítems", async () => {
    const report = await newReport(A);
    const item = await newItem(A, report);
    await expect(
      asUser(
        A,
        (tx) =>
          tx`update feedback_reports set status = 'visto', sent_at = now() where id = ${report}`,
      ),
    ).rejects.toThrow(/row-level security/);
    await expect(
      asUser(A, (tx) => tx`update feedback_items set status = 'resuelto' where id = ${item}`),
    ).rejects.toThrow(/row-level security/);
    await expect(newItem(A, report, 1, { status: "visto" })).rejects.toThrow(/row-level security/);
  });

  it("edita ítems, y borra ítems y adjuntos, mientras es borrador", async () => {
    const [r] = await owner<{ id: string }[]>`select id from feedback_reports where user_id = ${A}`;
    const [i] = await owner<
      { id: string }[]
    >`select id from feedback_items where report_id = ${r!.id}`;
    const upd = await asUser(
      A,
      (tx) =>
        tx`update feedback_items set message = 'Editado', updated_at = now() where id = ${i!.id}`,
    );
    expect(upd.count).toBe(1);
    const att = await newAttachment(A, i!.id, "pdf");
    const delAtt = await asUser(A, (tx) => tx`delete from feedback_attachments where id = ${att}`);
    expect(delAtt.count).toBe(1);
    const blob = await newBlob(A);
    const delBlob = await asUser(A, (tx) => tx`delete from blob_files where id = ${blob}`);
    expect(delBlob.count).toBe(1);
  });

  it("la app no actualiza adjuntos ni archivos (sin UPDATE)", async () => {
    const [i] = await owner<{ id: string }[]>`select id from feedback_items where user_id = ${A}`;
    const att = await newAttachment(A, i!.id);
    const updAtt = await asUser(
      A,
      (tx) => tx`update feedback_attachments set deleted_at = now() where id = ${att}`,
    );
    expect(updAtt.count).toBe(0);
    const updBlob = await asUser(A, (tx) => tx`update blob_files set content_type = 'x'`);
    expect(updBlob.count).toBe(0);
    const [still] = await owner`select deleted_at from feedback_attachments where id = ${att}`;
    expect(still!.deleted_at).toBeNull();
  });

  it("al enviarlo queda congelado: nada se agrega, edita ni borra, y no se vuelve a enviar", async () => {
    const [r] = await owner<{ id: string }[]>`select id from feedback_reports where user_id = ${A}`;
    const [i] = await owner<
      { id: string }[]
    >`select id from feedback_items where report_id = ${r!.id} limit 1`;
    await send(A, r!.id);
    const [sent] = await owner`select status, sent_at from feedback_reports where id = ${r!.id}`;
    expect(sent!.status).toBe("enviado");
    expect(sent!.sent_at).not.toBeNull();

    await expect(newItem(A, r!.id, 3)).rejects.toThrow(/row-level security/);
    await expect(newAttachment(A, i!.id)).rejects.toThrow(/row-level security/);
    const edit = await asUser(
      A,
      (tx) => tx`update feedback_items set message = 'Tarde' where id = ${i!.id}`,
    );
    expect(edit.count).toBe(0);
    const delItem = await asUser(A, (tx) => tx`delete from feedback_items where id = ${i!.id}`);
    expect(delItem.count).toBe(0);
    const delAtt = await asUser(
      A,
      (tx) => tx`delete from feedback_attachments where item_id = ${i!.id}`,
    );
    expect(delAtt.count).toBe(0);
    const delReport = await asUser(A, (tx) => tx`delete from feedback_reports where id = ${r!.id}`);
    expect(delReport.count).toBe(0);
    const resend = await asUser(
      A,
      (tx) => tx`update feedback_reports set status = 'resuelto' where id = ${r!.id}`,
    );
    expect(resend.count).toBe(0);
    const [still] = await owner`select status from feedback_reports where id = ${r!.id}`;
    expect(still!.status).toBe("enviado");
    const [msg] = await owner`select message from feedback_items where id = ${i!.id}`;
    expect(msg!.message).toBe("Editado");
  });

  it("tras enviar puede armar un informe nuevo", async () => {
    await expect(newReport(A)).resolves.toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("CHECK de la base", () => {
  it("el mensaje del ítem llega a 50.000 caracteres y puede ir vacío", async () => {
    await cleanAll();
    const report = await newReport(A);
    await newItem(A, report, 0, { message: "x".repeat(50_000) });
    await newItem(A, report, 1, { message: "" });
    await expect(newItem(A, report, 2, { message: "x".repeat(50_001) })).rejects.toThrow(
      /feedback_items_message_length/,
    );
  });

  it("categoría, posición (30 ítems como máximo) y pantalla", async () => {
    const [r] = await owner<{ id: string }[]>`select id from feedback_reports where user_id = ${A}`;
    await expect(newItem(A, r!.id, 3, { category: "otra" })).rejects.toThrow(
      /feedback_items_category_check/,
    );
    await expect(newItem(A, r!.id, 30)).rejects.toThrow(/feedback_items_position_range/);
    await expect(newItem(A, r!.id, 0)).rejects.toThrow(/feedback_items_report_position/);
    await expect(
      asUser(
        A,
        (tx) => tx`insert into feedback_items (report_id, user_id, position, path, category)
                   values (${r!.id}, ${A}, 4, ${"/" + "p".repeat(200)}, 'idea')`,
      ),
    ).rejects.toThrow(/feedback_items_path_length/);
  });

  it("los 30 ítems entran (posiciones 0 a 29)", async () => {
    const report = await newReport(B);
    for (let p = 0; p < 30; p++) await newItem(B, report, p);
    const [n] =
      await owner`select count(*)::int as n from feedback_items where report_id = ${report}`;
    expect(n!.n).toBe(30);
    await expect(newItem(B, report, 30)).rejects.toThrow(/feedback_items_position_range/);
  });

  it("adjuntos: tipo, tamaño, sha256 y dimensiones coherentes", async () => {
    const [i] = await owner<
      { id: string }[]
    >`select id from feedback_items where user_id = ${A} limit 1`;
    const insert = (over: Record<string, unknown>) => {
      const v = {
        kind: "image",
        bytes: 4,
        sha: SHA,
        width: 10,
        height: 10,
        name: "a.webp",
        ...over,
      };
      return asUser(
        A,
        (tx) => tx`insert into feedback_attachments
          (user_id, item_id, original_name, kind, mime, bytes, sha256, width, height)
          values (${A}, ${i!.id}, ${v.name as string}, ${v.kind as string}, 'x/y', ${v.bytes as number},
                  ${v.sha as string}, ${v.width as number | null}, ${v.height as number | null})`,
      );
    };
    await expect(insert({ kind: "svg" })).rejects.toThrow(/feedback_attachments_kind_check/);
    await expect(insert({ bytes: 0 })).rejects.toThrow(/feedback_attachments_bytes_range/);
    await expect(insert({ bytes: 10_485_761 })).rejects.toThrow(/feedback_attachments_bytes_range/);
    await expect(insert({ sha: "ZZ" })).rejects.toThrow(/feedback_attachments_sha256_check/);
    await expect(insert({ name: "" })).rejects.toThrow(/feedback_attachments_name_length/);
    await expect(insert({ height: null })).rejects.toThrow(/feedback_attachments_size_check/);
    await expect(insert({ width: 0, height: 0 })).rejects.toThrow(
      /feedback_attachments_size_check/,
    );
    await expect(
      insert({ kind: "pdf", width: null, height: null, bytes: 10_485_760 }),
    ).resolves.toBeDefined();
  });

  it("archivos: el tamaño declarado es el real y no pasa de 10 MB", async () => {
    await expect(
      asUser(
        A,
        (tx) => tx`insert into blob_files (user_id, content_type, bytes, sha256, data)
                   values (${A}, 'image/webp', 5, ${SHA}, decode('01020304', 'hex'))`,
      ),
    ).rejects.toThrow(/blob_files_bytes_match/);
    await expect(
      asUser(
        A,
        (tx) => tx`insert into blob_files (user_id, content_type, bytes, sha256, data)
                   values (${A}, 'image/webp', 4, 'no-es-hex', decode('01020304', 'hex'))`,
      ),
    ).rejects.toThrow(/blob_files_sha256_check/);
  });

  it("el estado del informe solo admite los cuatro valores y el enviado trae fecha de envío", async () => {
    await expect(
      owner`insert into feedback_reports (user_id, status, sent_at) values (${B}, 'archivado', now())`,
    ).rejects.toThrow(/feedback_reports_status_check/);
    await expect(
      owner`insert into feedback_reports (user_id, status) values (${B}, 'enviado')`,
    ).rejects.toThrow(/feedback_reports_sent_check/);
  });
});

describe("lectura del admin por las funciones", () => {
  let sentId = "";
  let draftId = "";

  it("prepara: B envía un informe con dos ítems y tres adjuntos (uno borrado) y A deja un borrador", async () => {
    await cleanAll();
    const rB = await newReport(B);
    const i0 = await newItem(B, rB, 0, { message: "Primero", category: "algo_no_anduvo" });
    const i1 = await newItem(B, rB, 1, { message: "Segundo" });
    await newAttachment(B, i0, "image");
    await newAttachment(B, i0, "pdf");
    const gone = await newAttachment(B, i1, "image");
    await owner`update feedback_attachments set deleted_at = now(), blob_ref = null where id = ${gone}`;
    await send(B, rB);
    sentId = rB;
    draftId = await newReport(A);
    await newItem(A, draftId, 0, { message: "Borrador de A" });
    expect(sentId).not.toBe(draftId);
  });

  it("admin_feedback_reports lista lo enviado con los conteos y sin borradores", async () => {
    const rows = await asUser(ADMIN_ID, (tx) => tx`select * from admin_feedback_reports(50)`);
    expect(rows.map((r) => r.id)).toEqual([sentId]);
    const r = rows[0]!;
    expect(Object.keys(r).sort()).toEqual([
      "documents",
      "id",
      "items",
      "items_new",
      "person",
      "screenshots",
      "sent_at",
      "status",
      "status_changed_at",
    ]);
    expect(r.status).toBe("enviado");
    expect(r.person).toMatch(/^[0-9a-f]{6}$/);
    expect(r.items).toBe(2);
    expect(r.items_new).toBe(2);
    expect(r.screenshots).toBe(1); // la otra captura está borrada
    expect(r.documents).toBe(1);
    expect(JSON.stringify(rows)).not.toMatch(/@/);
  });

  it("admin_feedback_report trae los ítems en orden y los adjuntos vigentes, sin email ni nombre", async () => {
    const rows = await asUser(
      ADMIN_ID,
      (tx) => tx`select * from admin_feedback_report(${sentId}::uuid)`,
    );
    expect(rows.map((r) => [r.item_position, r.message, r.attachment_kind])).toEqual([
      [0, "Primero", "image"],
      [0, "Primero", "pdf"],
      [1, "Segundo", null],
    ]);
    expect(rows[0]!.report_status).toBe("enviado");
    expect(rows[0]!.category).toBe("algo_no_anduvo");
    expect(rows[0]!.person).toMatch(/^[0-9a-f]{6}$/);
    expect(JSON.stringify(rows)).not.toMatch(/@/);
  });

  it("un borrador o un id inexistente devuelven 0 filas", async () => {
    expect(
      await asUser(ADMIN_ID, (tx) => tx`select * from admin_feedback_report(${draftId}::uuid)`),
    ).toHaveLength(0);
    expect(
      await asUser(
        ADMIN_ID,
        (tx) =>
          tx`select * from admin_feedback_report('e2900000-0000-4000-8000-0000000000ff'::uuid)`,
      ),
    ).toHaveLength(0);
  });

  it("quien no es admin no llama a las funciones, ni siquiera con su propio informe", async () => {
    await expect(asUser(B, (tx) => tx`select * from admin_feedback_reports(10)`)).rejects.toThrow(
      /admin_feedback_reports: no autorizado/,
    );
    await expect(
      asUser(B, (tx) => tx`select * from admin_feedback_report(${sentId}::uuid)`),
    ).rejects.toThrow(/admin_feedback_report: no autorizado/);
  });

  it("el admin, por sí solo, no lee las tablas ni los archivos de otra persona", async () => {
    for (const table of [
      "feedback_reports",
      "feedback_items",
      "feedback_attachments",
      "blob_files",
    ]) {
      expect(await asUser(ADMIN_ID, (tx) => tx.unsafe(`select 1 from ${table}`))).toHaveLength(0);
    }
  });

  it("las funciones son SECURITY DEFINER con search_path fijo y sin EXECUTE para PUBLIC", async () => {
    const rows = await owner<{ proname: string; fixed: boolean; public_exec: boolean }[]>`
      select p.proname,
             exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%') as fixed,
             has_function_privilege('public', p.oid, 'EXECUTE') as public_exec
        from pg_proc p
       where p.prosecdef and p.proname in ('admin_feedback_reports', 'admin_feedback_report')
       order by p.proname`;
    expect(rows).toEqual([
      { proname: "admin_feedback_report", fixed: true, public_exec: false },
      { proname: "admin_feedback_reports", fixed: true, public_exec: false },
    ]);
  });
});

describe("borrar la cuenta", () => {
  it("se lleva el informe, los ítems, los adjuntos y los archivos", async () => {
    await newBlob(B);
    const count = async (id: string) => {
      const out: Record<string, number> = {};
      for (const t of [
        "feedback_reports",
        "feedback_items",
        "feedback_attachments",
        "blob_files",
      ]) {
        const [r] = await owner.unsafe<{ n: number }[]>(
          `select count(*)::int as n from ${t} where user_id = $1`,
          [id],
        );
        out[t] = r!.n;
      }
      return out;
    };
    const before = await count(B);
    expect(Object.values(before).every((n) => n > 0)).toBe(true);
    await owner`delete from users where id = ${B}`;
    expect(await count(B)).toEqual({
      feedback_reports: 0,
      feedback_items: 0,
      feedback_attachments: 0,
      blob_files: 0,
    });
    // lo de A sigue
    expect((await count(A)).feedback_reports).toBeGreaterThan(0);
  });
});
