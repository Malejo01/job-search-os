import { originAllowed, pgBinaryStorage } from "@job-search-os/adapters";
import { schema as s, type Db } from "@job-search-os/db";
import {
  ATTACHMENT_ERROR_TEXTS,
  ATTACHMENT_UPLOADS_PER_DAY,
  ATTACHMENT_UPLOADS_PER_MINUTE,
  PERSON_FILES_MAX_BYTES,
  feedbackFilesGlobalMaxBytes,
  validateAttachmentUpload,
  type AttachmentErrorCode,
  type AttachmentKind,
} from "@job-search-os/pipeline";
import { createHash } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { withUser } from "./db";
import { isAdminUser } from "./admin-guard";
import { siteUrl } from "./site-url";

/**
 * Lógica de servidor de las rutas de adjuntos del informe (R29-04): parseo del multipart, límite de subidas,
 * códigos de error, cabeceras de la descarga y el acceso a la base (siempre con el rol de la app dentro del
 * contexto de la persona; el admin entra por funciones SECURITY DEFINER, rls/0070). Ninguna salida lleva la
 * ref `pgb:` ni una URL pública.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

export const NO_STORE = { "Cache-Control": "private, no-store" } as const;

export const ERROR_STATUS: Record<AttachmentErrorCode, number> = {
  invalid_input: 400,
  empty: 400,
  request_too_large: 413,
  item_full: 409,
  type: 415,
  image_reencode: 415,
  corrupt: 422,
  too_large: 413,
  unsafe_pdf: 422,
  unsafe_docx: 422,
  person_quota: 413,
  global_quota: 507,
  rate_limited: 429,
  no_session: 401,
  forbidden: 404, // para no confirmar que existe: igual que «no es tuyo»
  not_found: 404,
  report_locked: 409,
  bad_request: 400,
  server_error: 500,
};

/** Respuesta de error con el contrato `{ ok: false, error }` y el texto en llano. */
export function errorResponse(code: AttachmentErrorCode): Response {
  return Response.json(
    { ok: false, error: code, message: ATTACHMENT_ERROR_TEXTS[code] },
    { status: ERROR_STATUS[code], headers: NO_STORE },
  );
}

export type UploadForm =
  | { ok: true; itemId: string; name: string; bytes: Uint8Array }
  | { ok: false; error: AttachmentErrorCode };

/**
 * Lee el multipart con `itemId` (UUID) y un solo archivo `file`. Cualquier otra forma (sin archivo, dos
 * archivos, `itemId` repetido o mal formado) es `bad_request`.
 */
export async function parseUploadForm(body: Uint8Array, contentType: string): Promise<UploadForm> {
  if (!/^multipart\/form-data\s*;/i.test(contentType)) return { ok: false, error: "bad_request" };
  let form: FormData;
  try {
    form = await new Response(body as BodyInit, {
      headers: { "content-type": contentType },
    }).formData();
  } catch {
    return { ok: false, error: "bad_request" };
  }
  const itemIds = form.getAll("itemId");
  const fileParts = form.getAll("file");
  const anyFiles = [...form.values()].filter((v) => typeof v !== "string");
  const itemId = itemIds[0];
  const file = fileParts[0];
  if (
    itemIds.length !== 1 ||
    fileParts.length !== 1 ||
    anyFiles.length !== 1 ||
    !isUuid(itemId) ||
    typeof file === "string" ||
    !file
  ) {
    return { ok: false, error: "bad_request" };
  }
  return {
    ok: true,
    itemId: itemId.toLowerCase(),
    // El tipo y la extensión que declara el cliente no se usan: manda lo que dicen los bytes
    name: file.name,
    bytes: new Uint8Array(await file.arrayBuffer()),
  };
}

/** Límite de subidas por persona, contadas en la base (la ventana de un minuto y la de un día). */
export function decideUploadRate(counts: {
  lastMinute: number;
  lastDay: number;
}): "ok" | "rate_limited" {
  const valid = [counts.lastMinute, counts.lastDay].every((n) => Number.isFinite(n) && n >= 0);
  if (!valid) return "rate_limited";
  if (counts.lastMinute >= ATTACHMENT_UPLOADS_PER_MINUTE) return "rate_limited";
  if (counts.lastDay >= ATTACHMENT_UPLOADS_PER_DAY) return "rate_limited";
  return "ok";
}

/** `filename*` de RFC 5987: porcentaje de todo lo que no sea alfanumérico o `.-_`. */
function pctEncode(s: string): string {
  return encodeURIComponent(s).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/** `attachment` para PDF y DOCX; `inline` solo para las imágenes WebP reescritas por el servidor. */
export function contentDisposition(kind: AttachmentKind, name: string): string {
  // eslint-disable-next-line no-control-regex
  const clean = name.replace(/[\u0000-\u001f\u007f"\\/]/g, "_");
  const ascii = clean.replace(/[^A-Za-z0-9._-]/g, "_") || "adjunto";
  return `${kind === "image" ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${pctEncode(clean)}`;
}

/** Cabeceras de la descarga: tipo de la base (nunca el del cliente), sin sniffing, sandbox y sin caché. */
export function downloadHeaders(att: {
  kind: AttachmentKind;
  mime: string;
  name: string;
  size: number;
}): Record<string, string> {
  return {
    "Content-Type": att.mime,
    "Content-Length": String(att.size),
    "Content-Disposition": contentDisposition(att.kind, att.name),
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "sandbox; frame-ancestors 'none'",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Referrer-Policy": "no-referrer",
    ...NO_STORE,
  };
}

// ---------------------------------------------------------------------------------------------------------
// Origen del pedido
// ---------------------------------------------------------------------------------------------------------

/** Los pedidos que cambian algo (subir, borrar) tienen que venir de la propia app. */
export function requestOriginOk(request: Request): boolean {
  const allowed = [new URL(request.url).origin, siteUrl()];
  if (process.env.AUTH_URL) allowed.push(process.env.AUTH_URL);
  return originAllowed(request.headers.get("origin"), allowed);
}

// ---------------------------------------------------------------------------------------------------------
// Base
// ---------------------------------------------------------------------------------------------------------

type Tx = Parameters<Parameters<typeof withUser>[1]>[0];
const asDb = (tx: Tx) => tx as unknown as Db;

export interface AttachmentView {
  id: string;
  name: string;
  kind: AttachmentKind;
  bytes: number;
  width: number | null;
  height: number | null;
}

export type UploadResult =
  { ok: true; attachment: AttachmentView } | { ok: false; error: AttachmentErrorCode };

/** Candado de las subidas: serializa los cupos (ítem, persona y global) para que dos a la vez no los pasen. */
const UPLOAD_LOCK = sql`select pg_advisory_xact_lock(hashtextextended('feedback_files_upload', 0))`;

async function uploadCounts(tx: Tx): Promise<{ lastMinute: number; lastDay: number }> {
  // RLS: solo cuenta las filas de la persona
  const rows = (await tx.execute(
    sql`select count(*) filter (where created_at > now() - interval '1 minute')::int as m,
               count(*)::int as d
          from feedback_attachments where created_at > now() - interval '1 day'`,
  )) as unknown as { m: number; d: number }[];
  return { lastMinute: Number(rows[0]?.m ?? 0), lastDay: Number(rows[0]?.d ?? 0) };
}

/** Control rápido antes de leer el cuerpo: si ya pasó el límite, ni se lee. El definitivo va en la transacción. */
export async function uploadRateLimited(userId: string): Promise<boolean> {
  const counts = await withUser(userId, uploadCounts);
  return decideUploadRate(counts) !== "ok";
}

/**
 * Valida y guarda un adjunto en un ítem propio de un informe en borrador. Todo en una transacción de la persona:
 * el candado, los cupos, el archivo (`blob_files`) y la fila (`feedback_attachments`) entran juntos o no entra
 * nada. Devuelve solo los datos de la vista (nunca la ref).
 */
export async function storeFeedbackFile(
  userId: string,
  input: { itemId: string; name: string; bytes: Uint8Array },
): Promise<UploadResult> {
  return withUser(userId, async (tx): Promise<UploadResult> => {
    await tx.execute(UPLOAD_LOCK);

    const items = (await tx.execute(
      sql`select r.status as report_status
            from feedback_items i join feedback_reports r on r.id = i.report_id
           where i.id = ${input.itemId}::uuid`,
    )) as unknown as { report_status: string }[];
    if (!items[0]) return { ok: false, error: "not_found" };
    if (items[0].report_status !== "borrador") return { ok: false, error: "report_locked" };

    if (decideUploadRate(await uploadCounts(tx)) !== "ok")
      return { ok: false, error: "rate_limited" };

    const [mine] = (await tx.execute(
      sql`select (select count(*) from feedback_attachments where item_id = ${input.itemId}::uuid and deleted_at is null)::int as item_count,
                 (select coalesce(sum(bytes), 0) from feedback_attachments where deleted_at is null)::bigint as person_bytes,
                 feedback_files_global_bytes() as global_bytes`,
    )) as unknown as {
      item_count: number;
      person_bytes: string | number;
      global_bytes: string | number;
    }[];

    const checked = validateAttachmentUpload({
      bytes: input.bytes,
      name: input.name,
      itemCount: Number(mine?.item_count),
      personBytes: Number(mine?.person_bytes),
      globalBytes: Number(mine?.global_bytes),
      personMaxBytes: PERSON_FILES_MAX_BYTES,
      globalMaxBytes: feedbackFilesGlobalMaxBytes(process.env),
    });
    if (!checked.ok) return { ok: false, error: checked.reason };

    const ref = await pgBinaryStorage(asDb(tx)).put({
      userId,
      contentType: checked.mime,
      bytes: checked.bytes,
    });
    const [row] = await asDb(tx)
      .insert(s.feedbackAttachments)
      .values({
        userId,
        itemId: input.itemId,
        originalName: checked.name,
        kind: checked.kind,
        mime: checked.mime,
        bytes: checked.bytes.byteLength,
        sha256: createHash("sha256").update(checked.bytes).digest("hex"),
        blobRef: ref,
        width: checked.width,
        height: checked.height,
      })
      .returning({ id: s.feedbackAttachments.id });
    return {
      ok: true,
      attachment: {
        id: row!.id,
        name: checked.name,
        kind: checked.kind,
        bytes: checked.bytes.byteLength,
        width: checked.width,
        height: checked.height,
      },
    };
  });
}

export interface FileToServe {
  kind: AttachmentKind;
  mime: string;
  name: string;
  bytes: Uint8Array;
}

/**
 * El archivo para la descarga: primero como dueña (RLS), después, si es admin, por la función del admin (solo
 * informes ya enviados). `null` para «no existe», «no es tuyo» y «ya se limpió»: la respuesta es la misma.
 */
export async function loadFeedbackFile(userId: string, id: string): Promise<FileToServe | null> {
  const own = await withUser(userId, async (tx) => {
    const [a] = await asDb(tx)
      .select({
        kind: s.feedbackAttachments.kind,
        mime: s.feedbackAttachments.mime,
        name: s.feedbackAttachments.originalName,
        ref: s.feedbackAttachments.blobRef,
      })
      .from(s.feedbackAttachments)
      .where(and(eq(s.feedbackAttachments.id, id), isNull(s.feedbackAttachments.deletedAt)))
      .limit(1);
    if (!a || !a.ref) return null;
    const blob = await pgBinaryStorage(asDb(tx)).get(a.ref);
    if (!blob) return null;
    return { kind: a.kind as AttachmentKind, mime: a.mime, name: a.name, bytes: blob.bytes };
  });
  if (own) return own;
  if (!(await isAdminUser(userId))) return null;
  const rows = (await withUser(userId, (tx) =>
    tx.execute(sql`select * from admin_feedback_attachment(${id}::uuid)`),
  )) as unknown as { kind: string; mime: string; original_name: string; data: Buffer }[];
  const r = rows[0];
  if (!r) return null;
  return {
    kind: r.kind as AttachmentKind,
    mime: r.mime,
    name: r.original_name,
    bytes: new Uint8Array(r.data),
  };
}

export type DeleteResult = { ok: true } | { ok: false; error: AttachmentErrorCode };

/** Borra un adjunto propio de un informe en borrador, con su archivo. Los enviados no se tocan. */
export async function deleteFeedbackFile(userId: string, id: string): Promise<DeleteResult> {
  return withUser(userId, async (tx): Promise<DeleteResult> => {
    const rows = (await tx.execute(
      sql`select a.blob_ref, r.status as report_status
            from feedback_attachments a
            join feedback_items i on i.id = a.item_id
            join feedback_reports r on r.id = i.report_id
           where a.id = ${id}::uuid`,
    )) as unknown as { blob_ref: string | null; report_status: string }[];
    const row = rows[0];
    if (!row) return { ok: false, error: "not_found" };
    if (row.report_status !== "borrador") return { ok: false, error: "report_locked" };
    await asDb(tx).delete(s.feedbackAttachments).where(eq(s.feedbackAttachments.id, id));
    if (row.blob_ref) await pgBinaryStorage(asDb(tx)).delete(row.blob_ref);
    return { ok: true };
  });
}
