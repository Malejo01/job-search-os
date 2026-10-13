import { schema as s, type Db } from "@job-search-os/db";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";

/**
 * Adapter `storage` (ARCHITECTURE §2): crudos de ingesta. Hoy Postgres (tabla raw_blobs, RLS por
 * usuario); mañana S3 con la misma interfaz (ADR-007). Las refs son opacas: "pg:<uuid>".
 */
export type BlobRef = string;

export type BlobInput = {
  userId: string | null;
  kind: string;
  contentType: string;
  body: string;
};

export interface BlobStorage {
  put(input: BlobInput): Promise<BlobRef>;
  /** Opcional: varios crudos en una sola ida a la base. Devuelve las refs en el mismo orden. */
  putMany?(inputs: readonly BlobInput[]): Promise<BlobRef[]>;
  get(ref: BlobRef): Promise<{ contentType: string; body: string } | null>;
}

export function pgBlobStorage(db: Db): BlobStorage {
  return {
    async putMany(inputs) {
      if (!inputs.length) return [];
      const rows = inputs.map((i) => ({
        id: randomUUID(),
        userId: i.userId,
        kind: i.kind,
        contentType: i.contentType,
        body: i.body,
        bytes: Buffer.byteLength(i.body, "utf8"),
      }));
      await db.insert(s.rawBlobs).values(rows);
      return rows.map((r) => `pg:${r.id}`);
    },
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
