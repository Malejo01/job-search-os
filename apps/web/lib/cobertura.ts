import { readCareerCoverageJobs } from "@job-search-os/adapters";
import type { Db } from "@job-search-os/db";
import {
  BETA_LAUNCH_ROLE_KEYS,
  careerCoverage,
  type CareerCoverageRow,
} from "@job-search-os/pipeline";
import { sql } from "drizzle-orm";
import { withUser } from "./db";
import { canCreateInvitations } from "./invitations";

/**
 * Cobertura del pool por carrera de la beta (R32-02), solo servidor y solo admins: la misma verificación que
 * las demás métricas (`canCreateInvitations`; la página además pide `requireAdminOr404`). Solo lectura: UNA
 * consulta sobre `public_jobs`, el pool global, sin cruzar con tablas de usuarios. Devuelve números por
 * carrera y por fuente, nunca avisos. Las reglas (vigente, tomable, para quien empieza) viven en el pipeline.
 */
export type CoberturaResult =
  | { ok: true; rows: CareerCoverageRow[]; generatedAt: Date }
  | { ok: false; reason: "no_admin" | "sin_datos" };

export async function getCobertura(userId: string): Promise<CoberturaResult> {
  if (!(await canCreateInvitations(userId))) return { ok: false, reason: "no_admin" };
  try {
    const now = new Date();
    const jobs = await withUser(userId, async (tx) => {
      await tx.execute(sql`set local statement_timeout = '3s'`);
      return readCareerCoverageJobs(tx as unknown as Db, BETA_LAUNCH_ROLE_KEYS, now);
    });
    return { ok: true, rows: careerCoverage(BETA_LAUNCH_ROLE_KEYS, jobs, now), generatedAt: now };
  } catch {
    return { ok: false, reason: "sin_datos" };
  }
}
