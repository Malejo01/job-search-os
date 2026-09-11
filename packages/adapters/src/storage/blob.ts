import { schema as s, type Db } from "@job-search-os/db";
import { eq } from "drizzle-orm";

/**
 * Adapter `storage` (ARCHITECTURE §2): crudos de ingesta. Hoy Postgres (tabla raw_blobs, RLS por
 * usuario); mañana S3 con la misma interfaz (ADR-007). Las refs son opacas: "pg:<uuid>".
 */
export type BlobRef = string;

export interface BlobStorage {
  put(input: {
    userId: string | null;
    kind: string;
    contentType: string;
    body: string;
  }): Promise<BlobRef>;
  get(ref: BlobRef): Promise<{ contentType: string; body: string } | null>;
}

export function pgBlobStorage(db: Db): BlobStorage {
  return {
    async put({ userId, kind, contentType, body }) {
      const [row] = await db
        .insert(s.rawBlobs)
        .values({ userId, kind, contentType, body, bytes: Buffer.byteLength(body, "utf8") })
        .returning({ id: s.rawBlobs.id });
      return `pg:${row!.id}`;
    },
    async get(ref) {
      if (!ref.startsWith("pg:")) return null;
      const [row] = await db
        .select({ contentType: s.rawBlobs.contentType, body: s.rawBlobs.body })
        .from(s.rawBlobs)
        .where(eq(s.rawBlobs.id, ref.slice(3)))
        .limit(1);
      return row ?? null;
    },
  };
}
