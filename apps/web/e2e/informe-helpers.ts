import { deflateSync } from "node:zlib";
import * as s from "@job-search-os/db/schema";
import { and, asc, eq, inArray } from "drizzle-orm";
import { E2E_B_USER_ID, ownerDb } from "./helpers";

/**
 * Apoyo de los flujos 310-319 (R29, informe de revisión). La persona que arma el informe es la B (tester por
 * `ASSISTANT_TESTER_EMAILS`, playwright.config.ts). Los archivos de prueba se generan acá con bytes mínimos y
 * datos inventados: nada de binarios reales.
 *
 * `data-testid` estables de la pantalla `/recorrido/informe` (los usa también el e2e completo de `afi`, R29-07):
 * - `informe-estado` (con `data-estado`: idle|saving|saved|unsaved|error), `informe-error`, `informe-error-envio`
 * - `informe-agregar`, `informe-enviar`, `informe-confirmar` (el diálogo), `informe-resumen`, `informe-confirmar-si`
 * - `informe-item-N` (N desde 1): dentro, `informe-mensaje` (textarea), `informe-quitar`, `informe-adjuntos`,
 *   `informe-elegir`, `informe-capturar`, `informe-archivo` (input de archivos), `informe-lista-adjuntos`,
 *   `informe-adjunto`, `informe-quitar-adjunto`, `informe-aviso-adjunto`, `informe-subiendo`, `informe-contador`
 * - `informe-enviado` (el panel de «¡Informe enviado!»), `informe-afi` / `informe-afi-enviado` (Afi)
 * - en `/recorrido`: `recorrido-informe-link`; en el modal: `feedback-agregar-informe`, `feedback-gracias-informe`
 */

export const INFORME_URL = "/recorrido/informe";

/** Un PNG válido de un solo color (RGB, sin compresión de interés), generado en el test. */
export function makePng(
  width = 64,
  height = 48,
  rgb: [number, number, number] = [30, 120, 200],
): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // 8 bits por canal
  header[9] = 2; // RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array(width).fill(rgb).flat())]);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Un PDF mínimo y limpio (sin JavaScript ni acciones): una página en blanco. */
export function makePdf(extraBytes = 0): Buffer {
  const body =
    "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
    "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n" +
    "trailer<</Root 1 0 R>>\n%%EOF\n";
  return Buffer.concat([Buffer.from(body, "latin1"), Buffer.alloc(extraBytes, 0x20)]);
}

export type ReportRow = {
  id: string;
  status: string;
  sentAt: Date | null;
  items: { id: string; position: number; path: string; category: string; message: string }[];
  attachments: {
    id: string;
    itemId: string;
    kind: string;
    mime: string;
    bytes: number;
    name: string;
    width: number | null;
    height: number | null;
    blobRef: string | null;
  }[];
};

/** Los informes de una persona (el más nuevo primero), con ítems y adjuntos. */
export async function reportsOf(userId: string = E2E_B_USER_ID): Promise<ReportRow[]> {
  const { db, close } = ownerDb();
  try {
    const reports = await db
      .select()
      .from(s.feedbackReports)
      .where(eq(s.feedbackReports.userId, userId))
      .orderBy(asc(s.feedbackReports.createdAt));
    const out: ReportRow[] = [];
    for (const r of reports) {
      const items = await db
        .select({
          id: s.feedbackItems.id,
          position: s.feedbackItems.position,
          path: s.feedbackItems.path,
          category: s.feedbackItems.category,
          message: s.feedbackItems.message,
        })
        .from(s.feedbackItems)
        .where(eq(s.feedbackItems.reportId, r.id))
        .orderBy(asc(s.feedbackItems.position));
      const attachments = items.length
        ? await db
            .select({
              id: s.feedbackAttachments.id,
              itemId: s.feedbackAttachments.itemId,
              kind: s.feedbackAttachments.kind,
              mime: s.feedbackAttachments.mime,
              bytes: s.feedbackAttachments.bytes,
              name: s.feedbackAttachments.originalName,
              width: s.feedbackAttachments.width,
              height: s.feedbackAttachments.height,
              blobRef: s.feedbackAttachments.blobRef,
            })
            .from(s.feedbackAttachments)
            .where(
              and(
                inArray(
                  s.feedbackAttachments.itemId,
                  items.map((i) => i.id),
                ),
              ),
            )
        : [];
      out.push({ id: r.id, status: r.status, sentAt: r.sentAt, items, attachments });
    }
    return out.reverse();
  } finally {
    await close();
  }
}

/** Borra los informes de una persona y los archivos de `blob_files` (cada spec parte limpio y deja limpio). */
export async function clearReportsOf(userId: string = E2E_B_USER_ID): Promise<void> {
  const { db, close } = ownerDb();
  try {
    await db.delete(s.blobFiles).where(eq(s.blobFiles.userId, userId));
    await db.delete(s.feedbackReports).where(eq(s.feedbackReports.userId, userId));
  } finally {
    await close();
  }
}

/** Siembra un informe en borrador con ítems ficticios (sin adjuntos). Devuelve los ids de los ítems. */
export async function seedDraft(
  messages: string[],
  userId: string = E2E_B_USER_ID,
): Promise<{ reportId: string; itemIds: string[] }> {
  const { db, close } = ownerDb();
  try {
    const [report] = await db
      .insert(s.feedbackReports)
      .values({ userId })
      .returning({ id: s.feedbackReports.id });
    const itemIds: string[] = [];
    for (const [position, message] of messages.entries()) {
      const [item] = await db
        .insert(s.feedbackItems)
        .values({
          reportId: report!.id,
          userId,
          position,
          path: "/hoy",
          category: "idea",
          message,
        })
        .returning({ id: s.feedbackItems.id });
      itemIds.push(item!.id);
    }
    return { reportId: report!.id, itemIds };
  } finally {
    await close();
  }
}
