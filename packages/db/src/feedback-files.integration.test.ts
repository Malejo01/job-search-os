import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "./migrate";

/**
 * Adjuntos del informe de revisión (R29-04/05, rls/0069 y rls/0070) por el camino real: la app como
 * jobsearch_app. Cada persona ve y toca solo lo suyo; el admin lee lo enviado por funciones definer, nunca un
 * borrador; el estado lo cambia solo el admin. Datos inventados; los archivos son bytes mínimos.
 */
const APP_PASSWORD = "jobsearch_app_test";
const ADMIN_ID = "e2900000-0000-4000-8000-0000000000aa";
const A = "e2900000-0000-4000-8000-000000000001";
const B = "e2900000-0000-4000-8000-000000000002";
const ALL = [ADMIN_ID, A, B];

let container: StartedPostgreSqlContainer | null = null;
let owner: Sql;
let app: Sql;

async function asUser<T>(userId: string, fn: (tx: Sql) => Promise<T>): Promise<T> {
  return (await app.begin(async (tx) => {
    await tx`select set_config('app.user_id', ${userId}, true)`;
    return fn(tx as unknown as Sql);
  })) as T;
}

const SHA = "a".repeat(64);
const PDF = Buffer.from("%PDF-1.4\n%%EOF\n");

/** Un informe de `user` con un ítem y, si se pide, un adjunto con su archivo. Lo arma el dueño de la base. */
async function seed(user: string, status: "borrador" | "enviado", withFile = true) {
  const [r] = await owner<{ id: string }[]>`
    insert into feedback_reports (user_id, status, sent_at)
    values (${user}, ${status}, ${status === "borrador" ? null : new Date()}) returning id`;
  const [i] = await owner<{ id: string }[]>`
    insert into feedback_items (report_id, user_id, position, path, category, message)
    values (${r!.id}, ${user}, 0, '/hoy', 'idea', 'Texto de prueba') returning id`;
  let attachmentId: string | null = null;
  if (withFile) {
    const [b] = await owner<{ id: string }[]>`
      insert into blob_files (user_id, content_type, bytes, sha256, data)
      values (${user}, 'application/pdf', ${PDF.length}, ${SHA}, ${PDF}) returning id`;
    const [a] = await owner<{ id: string }[]>`
      insert into feedback_attachments (user_id, item_id, original_name, kind, mime, bytes, sha256, blob_ref)
      values (${user}, ${i!.id}, 'informe.pdf', 'pdf', 'application/pdf', ${PDF.length}, ${SHA}, ${"pgb:" + b!.id})
      returning id`;
    attachmentId = a!.id;
  }
  return { reportId: r!.id, itemId: i!.id, attachmentId };
}

async function clean() {
  await owner`delete from feedback_reports where user_id in ${owner(ALL)}`;
  await owner`delete from blob_files where user_id in ${owner(ALL)}`;
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
    await clean();
    await owner`delete from app_admins where user_id = ${ADMIN_ID}`;
    await owner`delete from users where id in ${owner(ALL)}`;
  }
  await app?.end();
  await owner?.end();
  await container?.stop();
});

describe("adjuntos: RLS por persona", () => {
  it("la persona ve sus adjuntos y archivos; la otra no ve nada", async () => {
    await clean();
    const a = await seed(A, "borrador");
    expect(await asUser(A, (tx) => tx`select id from feedback_attachments`)).toHaveLength(1);
    expect(await asUser(A, (tx) => tx`select id from blob_files`)).toHaveLength(1);
    expect(await asUser(B, (tx) => tx`select id from feedback_attachments`)).toHaveLength(0);
    expect(await asUser(B, (tx) => tx`select id from blob_files`)).toHaveLength(0);
    expect(
      await asUser(B, (tx) => tx`select id from feedback_items where id = ${a.itemId}`),
    ).toHaveLength(0);
  });

  it("nadie sube un adjunto a un ítem de otra persona ni con otro user_id", async () => {
    await clean();
    const a = await seed(A, "borrador", false);
    const insert = (who: string, owned: string, item: string) =>
      asUser(
        who,
        (
          tx,
        ) => tx`insert into feedback_attachments (user_id, item_id, original_name, kind, mime, bytes, sha256)
                   values (${owned}, ${item}, 'x.pdf', 'pdf', 'application/pdf', 10, ${SHA})`,
      );
    await expect(insert(B, B, a.itemId)).rejects.toThrow(/row-level security/);
    await expect(insert(B, A, a.itemId)).rejects.toThrow(/row-level security/);
    await expect(insert(A, B, a.itemId)).rejects.toThrow(/row-level security/);
    await insert(A, A, a.itemId);
  });

  it("con el informe enviado no se agregan ni se borran adjuntos desde la app", async () => {
    await clean();
    const sent = await seed(A, "enviado");
    await expect(
      asUser(
        A,
        (
          tx,
        ) => tx`insert into feedback_attachments (user_id, item_id, original_name, kind, mime, bytes, sha256)
                   values (${A}, ${sent.itemId}, 'y.pdf', 'pdf', 'application/pdf', 10, ${SHA})`,
      ),
    ).rejects.toThrow(/row-level security/);
    const del = await asUser(
      A,
      (tx) => tx`delete from feedback_attachments where id = ${sent.attachmentId}`,
    );
    expect(del.count).toBe(0);
    // La app ni siquiera tiene permiso de UPDATE sobre adjuntos (el borrado lógico es de una función definer)
    // (hoy el rol tiene el GRANT pero ninguna policy de UPDATE: afecta 0 filas)
    const upd = await asUser(
      A,
      (tx) => tx`update feedback_attachments set original_name = 'z.pdf'`,
    );
    expect(upd.count).toBe(0);
  });

  it("en un borrador, solo la dueña borra su adjunto", async () => {
    await clean();
    const d = await seed(A, "borrador");
    const other = await asUser(
      B,
      (tx) => tx`delete from feedback_attachments where id = ${d.attachmentId}`,
    );
    expect(other.count).toBe(0);
    const mine = await asUser(
      A,
      (tx) => tx`delete from feedback_attachments where id = ${d.attachmentId}`,
    );
    expect(mine.count).toBe(1);
  });

  it("los CHECK de la base: tipo, tamaño, sha256 y alto/ancho", async () => {
    await clean();
    const d = await seed(A, "borrador", false);
    const bad = (kind: string, bytes: number, sha: string, w: number | null, h: number | null) =>
      asUser(
        A,
        (
          tx,
        ) => tx`insert into feedback_attachments (user_id, item_id, original_name, kind, mime, bytes, sha256, width, height)
                   values (${A}, ${d.itemId}, 'x', ${kind}, 'x/y', ${bytes}, ${sha}, ${w}, ${h})`,
      );
    await expect(bad("svg", 10, SHA, null, null)).rejects.toThrow(
      /feedback_attachments_kind_check/,
    );
    await expect(bad("pdf", 0, SHA, null, null)).rejects.toThrow(
      /feedback_attachments_bytes_range/,
    );
    await expect(bad("pdf", 10_485_761, SHA, null, null)).rejects.toThrow(
      /feedback_attachments_bytes_range/,
    );
    await expect(bad("pdf", 10, "zz", null, null)).rejects.toThrow(
      /feedback_attachments_sha256_check/,
    );
    await expect(bad("image", 10, SHA, 10, null)).rejects.toThrow(
      /feedback_attachments_size_check/,
    );
  });
});

describe("funciones del admin (rls/0070)", () => {
  it("cambia el estado del ítem y deriva el del informe", async () => {
    await clean();
    const s = await seed(A, "enviado", false);
    const [second] = await owner<{ id: string }[]>`
      insert into feedback_items (report_id, user_id, position, path, category, message)
      values (${s.reportId}, ${A}, 1, '/jobs', 'confuso', 'Otro') returning id`;
    const set = async (id: string, status: string) =>
      (
        await asUser(
          ADMIN_ID,
          (tx) => tx`select admin_feedback_item_set_status(${id}::uuid, ${status}) as ok`,
        )
      )[0]!.ok;
    const report = async () =>
      (
        await owner`select status, status_changed_at from feedback_reports where id = ${s.reportId}`
      )[0]!;

    expect(await set(s.itemId, "visto")).toBe(true);
    expect((await report()).status).toBe("visto");
    expect(await set(s.itemId, "resuelto")).toBe(true);
    expect((await report()).status).toBe("visto"); // falta el segundo
    expect(await set(second!.id, "resuelto")).toBe(true);
    expect((await report()).status).toBe("resuelto");
    expect((await report()).status_changed_at).not.toBeNull();
    expect(await set(second!.id, "nuevo")).toBe(true);
    expect((await report()).status).toBe("visto");
    const [item] =
      await owner`select status, status_changed_at from feedback_items where id = ${s.itemId}`;
    expect(item!.status).toBe("resuelto");
    expect(item!.status_changed_at).not.toBeNull();
  });

  it("un estado inválido, un ítem inexistente, un borrador o quien no es admin, no", async () => {
    await clean();
    const sent = await seed(A, "enviado", false);
    const draft = await seed(B, "borrador", false);
    const call = (who: string, id: string, status: string) =>
      asUser(who, (tx) => tx`select admin_feedback_item_set_status(${id}::uuid, ${status}) as ok`);
    await expect(call(ADMIN_ID, sent.itemId, "borrado")).rejects.toThrow(/estado inválido/);
    await expect(call(A, sent.itemId, "visto")).rejects.toThrow(/no autorizado/);
    expect((await call(ADMIN_ID, "e2900000-0000-4000-8000-0000000000ff", "visto"))[0]!.ok).toBe(
      false,
    );
    expect((await call(ADMIN_ID, draft.itemId, "visto"))[0]!.ok).toBe(false);
    const [row] = await owner`select status from feedback_items where id = ${draft.itemId}`;
    expect(row!.status).toBe("nuevo");
    // la app tampoco puede cambiar el estado directo
    const upd = await asUser(
      A,
      (tx) => tx`update feedback_items set status = 'resuelto' where id = ${sent.itemId}`,
    );
    expect(upd.count).toBe(0);
  });

  it("el admin lee los bytes de un adjunto enviado; no los de un borrador ni como otra persona", async () => {
    await clean();
    const sent = await seed(A, "enviado");
    const draft = await seed(B, "borrador");
    const read = (who: string, id: string) =>
      asUser(who, (tx) => tx`select * from admin_feedback_attachment(${id}::uuid)`);
    const rows = await read(ADMIN_ID, sent.attachmentId!);
    expect(rows).toHaveLength(1);
    expect(Buffer.from(rows[0]!.data as Buffer).equals(PDF)).toBe(true);
    expect(Object.keys(rows[0]!).sort()).toEqual([
      "bytes",
      "data",
      "id",
      "kind",
      "mime",
      "original_name",
    ]);
    expect(await read(ADMIN_ID, draft.attachmentId!)).toHaveLength(0);
    await expect(read(A, sent.attachmentId!)).rejects.toThrow(/no autorizado/);
  });

  it("un adjunto limpiado (deleted_at) ya no se descarga", async () => {
    await clean();
    const sent = await seed(A, "enviado");
    await owner`update feedback_attachments set deleted_at = now(), blob_ref = null where id = ${sent.attachmentId}`;
    const rows = await asUser(
      ADMIN_ID,
      (tx) => tx`select * from admin_feedback_attachment(${sent.attachmentId!}::uuid)`,
    );
    expect(rows).toHaveLength(0);
  });

  it("el cupo global suma los archivos de todas las personas y solo devuelve un número", async () => {
    await clean();
    await seed(A, "borrador");
    await seed(B, "enviado");
    const [row] = await asUser(A, (tx) => tx`select feedback_files_global_bytes() as n`);
    expect(Number(row!.n)).toBe(PDF.length * 2);
    // la persona sigue sin ver los archivos de B
    expect(await asUser(A, (tx) => tx`select id from blob_files`)).toHaveLength(1);
  });

  describe("limpieza de adjuntos de lo resuelto (R29-09)", () => {
    const DAY = 86_400_000;
    /** Un informe enviado de A con un ítem y un adjunto con archivo, con el estado y la edad del ítem dados. */
    async function resolvedItem(
      status: "nuevo" | "visto" | "resuelto",
      ageDays: number,
      report: "borrador" | "enviado" = "enviado",
    ) {
      const s = await seed(A, report);
      await owner`update feedback_items set status = ${status},
        status_changed_at = ${new Date(Date.now() - ageDays * DAY)} where id = ${s.itemId}`;
      return s;
    }
    const run = (who: string | null, days: number, item: string | null = null, dry = false) =>
      who
        ? asUser(
            who,
            (tx) =>
              tx`select * from purge_resolved_attachments(${days}::integer, ${item}::uuid, ${dry})`,
          )
        : owner`select * from purge_resolved_attachments(${days}::integer, ${item}::uuid, ${dry})`;
    const live = async (id: string) => {
      const [a] =
        await owner`select deleted_at, blob_ref from feedback_attachments where id = ${id}`;
      return a!;
    };

    it("solo borra lo resuelto con 30 días o más; lo nuevo, lo visto, lo reciente y los borradores quedan", async () => {
      await clean();
      const old = await resolvedItem("resuelto", 31);
      const recent = await resolvedItem("resuelto", 5);
      const seen = await resolvedItem("visto", 90);
      const fresh = await resolvedItem("nuevo", 90);
      const draft = await seed(A, "borrador");
      await owner`update feedback_items set status = 'resuelto', status_changed_at = ${new Date(Date.now() - 90 * DAY)} where id = ${draft.itemId}`;
      const [r] = await run(ADMIN_ID, 30);
      expect(r).toMatchObject({ files_deleted: 1 });
      expect(Number(r!.bytes_freed)).toBe(PDF.length);
      expect((await live(old.attachmentId!)).deleted_at).not.toBeNull();
      expect((await live(old.attachmentId!)).blob_ref).toBeNull();
      for (const keep of [recent, seen, fresh, draft]) {
        expect((await live(keep.attachmentId!)).deleted_at).toBeNull();
        expect((await live(keep.attachmentId!)).blob_ref).not.toBeNull();
      }
      // el archivo se fue, los demás siguen y el texto del ítem no se toca
      const [n] = await owner`select count(*)::int as n from blob_files where user_id = ${A}`;
      expect(n!.n).toBe(4);
      const [item] = await owner`select message from feedback_items where id = ${old.itemId}`;
      expect(item!.message).toBe("Texto de prueba");
    });

    it("el ensayo (dry run) cuenta sin borrar", async () => {
      await clean();
      const old = await resolvedItem("resuelto", 40);
      const [r] = await run(ADMIN_ID, 30, null, true);
      expect(r).toMatchObject({ files_deleted: 1 });
      expect((await live(old.attachmentId!)).deleted_at).toBeNull();
    });

    it("por ítem: borra los de un ítem resuelto sin esperar los días y no toca un ítem no resuelto", async () => {
      await clean();
      const resolved = await resolvedItem("resuelto", 0);
      const seen = await resolvedItem("visto", 100);
      expect((await run(ADMIN_ID, 0, seen.itemId))[0]).toMatchObject({ files_deleted: 0 });
      expect((await live(seen.attachmentId!)).deleted_at).toBeNull();
      expect((await run(ADMIN_ID, 0, resolved.itemId))[0]).toMatchObject({ files_deleted: 1 });
      expect((await live(resolved.attachmentId!)).deleted_at).not.toBeNull();
      // sin ítem, 0 días no vale
      await expect(run(ADMIN_ID, 0)).rejects.toThrow(/días inválidos/);
    });

    it("quien no es admin no puede correrla; el cron (conexión de servicio) sí", async () => {
      await clean();
      const old = await resolvedItem("resuelto", 60);
      await expect(run(A, 30)).rejects.toThrow(/no autorizado/);
      await expect(run(B, 30, old.itemId)).rejects.toThrow(/no autorizado/);
      await expect(
        app.begin(async (tx) => tx`select * from purge_resolved_attachments(30)`),
      ).rejects.toThrow(/no autorizado/);
      expect((await live(old.attachmentId!)).deleted_at).toBeNull();
      expect((await run(null, 30))[0]).toMatchObject({ files_deleted: 1 });
      expect((await live(old.attachmentId!)).deleted_at).not.toBeNull();
    });

    it("deja un registro en admin_events y el admin ve el adjunto borrado con su nombre y tamaño", async () => {
      await clean();
      await owner`delete from admin_events where user_id = ${A}`;
      const old = await resolvedItem("resuelto", 45);
      await run(ADMIN_ID, 30);
      const events = await owner`select action, admin_id from admin_events where user_id = ${A}`;
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ action: "adjuntos_purga", admin_id: ADMIN_ID });
      const rows = await asUser(
        ADMIN_ID,
        (tx) => tx`select * from admin_feedback_deleted_attachments(${old.reportId}::uuid)`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        attachment_name: "informe.pdf",
        attachment_bytes: PDF.length,
      });
      expect(rows[0]!.deleted_at).not.toBeNull();
      // y ya no se descarga ni aparece como adjunto vivo
      expect(
        await asUser(
          ADMIN_ID,
          (tx) => tx`select * from admin_feedback_attachment(${old.attachmentId!}::uuid)`,
        ),
      ).toHaveLength(0);
      const report = await asUser(
        ADMIN_ID,
        (tx) => tx`select attachment_id from admin_feedback_report(${old.reportId}::uuid)`,
      );
      expect(report.every((x) => x.attachment_id === null)).toBe(true);
      await expect(
        asUser(
          A,
          (tx) => tx`select * from admin_feedback_deleted_attachments(${old.reportId}::uuid)`,
        ),
      ).rejects.toThrow(/no autorizado/);
    });
  });

  it("las funciones no están abiertas a PUBLIC (sin sesión de usuario no hay admin)", async () => {
    await clean();
    const sent = await seed(A, "enviado");
    await expect(
      app.begin(
        async (tx) => tx`select * from admin_feedback_attachment(${sent.attachmentId!}::uuid)`,
      ),
    ).rejects.toThrow(/no autorizado/);
  });
});
