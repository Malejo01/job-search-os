import { readPoolCoverage } from "@job-search-os/adapters";
import type { Db } from "@job-search-os/db";
import {
  BETA_LAUNCH_ROLE_KEYS,
  buildPoolCoverage,
  type PoolCoverageRow,
} from "@job-search-os/pipeline";
import { withUser } from "./db";
import { canCreateInvitations } from "./invitations";

/**
 * Cobertura del pool por carrera de la beta (R16-4), solo servidor y solo admins: la misma verificación que
 * las demás métricas (`canCreateInvitations`, ADMIN_EMAILS; la página además pide `requireAdminOr404`). Solo
 * lectura: una consulta agregada sobre `public_jobs`, el pool global, sin cruzar con tablas de usuarios.
 */
export type PoolCoverageResult =
  | { ok: true; rows: PoolCoverageRow[]; generatedAt: Date }
  | { ok: false; reason: "no_admin" | "sin_datos" };

export async function getPoolCoverage(userId: string): Promise<PoolCoverageResult> {
  if (!(await canCreateInvitations(userId))) return { ok: false, reason: "no_admin" };
  try {
    const now = new Date();
    const counts = await withUser(userId, (tx) =>
      readPoolCoverage(tx as unknown as Db, BETA_LAUNCH_ROLE_KEYS, now),
    );
    return { ok: true, rows: buildPoolCoverage(BETA_LAUNCH_ROLE_KEYS, counts), generatedAt: now };
  } catch {
    return { ok: false, reason: "sin_datos" };
  }
}
