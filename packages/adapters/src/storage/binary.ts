import { schema as s, type Db } from "@job-search-os/db";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";

/**
 * Adaptador `storage` binario (R29-02, ADR-047): archivos de los adjuntos del informe de revisión. Hoy Postgres
 * (tabla `blob_files`, RLS por persona); mañana Vercel Blob u otro con la misma interfaz. Las refs son opacas
 * (`pgb:<uuid>`): quien las guarda no sabe dónde están los bytes. Aparte de `BlobStorage` (texto, `raw_blobs`),
 * que no se toca.
 *
 * Se usa con la `tx` de la persona (`withUser`): las policies de `blob_files` hacen el aislamiento. El tipo,
 * el tamaño y el contenido ya los validó `packages/pipeline` (`validateAttachmentUpload`); acá solo se
 * guarda, y la base repite el tope de 10 MB y la igualdad `bytes = octet_length(data)` con CHECK.
 */
export type BinaryRef = string;

export type BinaryInput = {
  userId: string;
  contentType: string;
  bytes: Uint8Array;
};

export interface BinaryStorage {
  put(input: BinaryInput): Promise<BinaryRef>;
  /** `null` si la ref no es de este adaptador, no existe o no es visible para quien consulta (RLS). */
  get(ref: BinaryRef): Promise<{ contentType: string; bytes: Uint8Array } | null>;
  /** Borra el archivo. Idempotente: una ref que no existe no es un error. */
  delete(ref: BinaryRef): Promise<void>;
}

const PREFIX = "pgb:";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** El id de una ref `pgb:<uuid>`, o `null` si no tiene esa forma (nunca llega a la consulta). */
export function parsePgBinaryRef(ref: unknown): string | null {
  if (typeof ref !== "string" || !ref.startsWith(PREFIX)) return null;
  const id = ref.slice(PREFIX.length);
  return UUID.test(id) ? id.toLowerCase() : null;
}

export function pgBinaryStorage(db: Db): BinaryStorage {
  return {
    async put({ userId, contentType, bytes }) {
      if (bytes.byteLength === 0) throw new Error("storage: archivo vacío");
      const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const [row] = await db
        .insert(s.blobFiles)
        .values({
          userId,
          contentType,
          bytes: data.byteLength,
          sha256: createHash("sha256").update(data).digest("hex"),
          data,
        })
        .returning({ id: s.blobFiles.id });
      return `${PREFIX}${row!.id}`;
    },
    async get(ref) {
      const id = parsePgBinaryRef(ref);
      if (!id) return null;
      const [row] = await db
        .select({ contentType: s.blobFiles.contentType, data: s.blobFiles.data })
        .from(s.blobFiles)
        .where(eq(s.blobFiles.id, id))
        .limit(1);
      if (!row) return null;
      return { contentType: row.contentType, bytes: new Uint8Array(row.data) };
    },
    async delete(ref) {
      const id = parsePgBinaryRef(ref);
      if (!id) return;
      await db.delete(s.blobFiles).where(eq(s.blobFiles.id, id));
    },
  };
}
