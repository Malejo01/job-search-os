import { createDb, requireDatabaseUrl, schema as s, type Db } from "@job-search-os/db";
import {
  createLogger,
  loadInterviewJob,
  tailorCv,
  type CvTailorDeps,
  type CvTailorFailure,
} from "@job-search-os/adapters";
import {
  cvTailorAllowed,
  cvTailorMode,
  cvTailorRefs,
  verifyCvTailor,
  type CvDocument,
  type CvTailorChange,
  type CvTailorOutput,
} from "@job-search-os/pipeline";
import { asc } from "drizzle-orm";
import { buildUserCv, type CvOptions } from "@/lib/cv-source";
import { withUser } from "@/lib/db";
import { serviceLlm } from "@/lib/llm-service";
import { getSessionEmail } from "@/lib/profile-agent/access";
import { testerEnvFor } from "@/lib/user-roles";

/**
 * Parte de servidor de la versión del CV adaptada con IA (R20-04). La versión sin IA (R20-03) es siempre el
 * respaldo: cualquier cosa que no salga limpia devuelve `fallback` y quien llama sigue con esa.
 *
 * Interfaz para la pantalla de la oferta y la descarga (R20-05):
 * - `cvTailorAllowedFor(userId)`: ¿se ofrece el botón? Con `CV_TAILOR` apagado no consulta la base.
 * - `runCvTailorForJob(userId, jobId)`: pide la versión (gasta cupo: 3 por día) y la verifica.
 * - `applyCvTailorProposal(userId, proposal)`: vuelve a verificar una propuesta ya pedida contra el CV de hoy,
 *   sin llamar al modelo ni gastar cupo. Es lo que usa la descarga: la propuesta viaja por el navegador, así
 *   que no se confía en ella, se verifica de nuevo. El archivo no se guarda en el servidor.
 */

/** Opciones con las que se arma el CV base de la versión adaptada. */
export const CV_TAILOR_BASE_OPTIONS: CvOptions = {
  lang: "es",
  includeEmail: true,
  includeBasics: false,
};

export type CvTailorFallbackReason =
  "off" | "no_cv" | "empty_cv" | "no_job" | CvTailorFailure["kind"] | "server";

export type CvTailorOutcome =
  | {
      kind: "tailored";
      /** Lo que propuso el modelo (ya validado y verificado): se puede volver a verificar sin gasto. */
      proposal: CvTailorOutput;
      /** El CV adaptado, ya verificado. */
      document: CvDocument;
      changes: CvTailorChange[];
      /** `false` si la versión quedó igual al CV confirmado. */
      changed: boolean;
    }
  | { kind: "fallback"; reason: CvTailorFallbackReason };

/** ¿Esta persona puede pedir la versión adaptada? Sin el flag no se consulta la base; ante un error, no. */
export async function cvTailorAllowedFor(userId: string): Promise<boolean> {
  if (cvTailorMode(process.env) === "off") return false;
  try {
    const email = await getSessionEmail(userId);
    return cvTailorAllowed(await testerEnvFor(userId, email), email);
  } catch {
    return false;
  }
}

/** Nombres de skills del catálogo: sirven para descartar una tecnología que el modelo le agregue a una viñeta. */
async function loadKnownTerms(userId: string): Promise<string[]> {
  const rows = await withUser(userId, (tx) =>
    tx.select({ name: s.skills.name }).from(s.skills).orderBy(asc(s.skills.name)).limit(3000),
  );
  return rows.map((r) => r.name);
}

/** Sin ninguna entrada con viñetas no hay nada que adaptar: no se llama al modelo ni se gasta cupo. */
function hasSomethingToTailor(cv: CvDocument): boolean {
  const withBullets = [...cvTailorRefs(cv).values()].filter(
    (r) =>
      (cv.sections.find((x) => x.id === r.sectionId)?.blocks[r.blockIndex]?.bullets.length ?? 0) >
      0,
  );
  return withBullets.length > 0;
}

async function withTailorDeps<T>(
  userId: string,
  fn: (deps: CvTailorDeps) => Promise<T>,
): Promise<T> {
  const conn = createDb(requireDatabaseUrl({ purpose: "service" }), { max: 2 });
  try {
    const logger = createLogger({ user_id: userId });
    return await fn({
      llm: serviceLlm(conn.db, logger),
      reserveDb: conn.db,
      knownTerms: await loadKnownTerms(userId),
      logger,
    });
  } finally {
    await conn.close();
  }
}

export async function runCvTailorForJob(userId: string, jobId: string): Promise<CvTailorOutcome> {
  if (!(await cvTailorAllowedFor(userId))) return { kind: "fallback", reason: "off" };
  try {
    const cv = await buildUserCv(userId, CV_TAILOR_BASE_OPTIONS);
    if (!cv) return { kind: "fallback", reason: "no_cv" };
    if (!hasSomethingToTailor(cv)) return { kind: "fallback", reason: "empty_cv" };
    const job = await withUser(userId, (tx) =>
      loadInterviewJob(tx as unknown as Db, userId, jobId),
    );
    if (!job) return { kind: "fallback", reason: "no_job" };
    const result = await withTailorDeps(userId, (deps) => tailorCv(deps, { userId, cv, job }));
    if (!result.ok) return { kind: "fallback", reason: result.error.kind };
    return {
      kind: "tailored",
      proposal: result.value.proposal,
      document: result.value.verified.document,
      changes: result.value.verified.changes,
      changed: result.value.verified.changed,
    };
  } catch (e) {
    createLogger({ user_id: userId }).error(
      { err_name: e instanceof Error ? e.name : "unknown" },
      "no se pudo armar la versión adaptada",
    );
    return { kind: "fallback", reason: "server" };
  }
}

/**
 * Vuelve a verificar una propuesta contra el CV confirmado de hoy y arma el documento. `null` si el flag está
 * apagado, si la persona no tiene CV o si la verificación la descarta (propuesta vieja, CV cambiado o
 * manipulada): quien llama cae a la versión por código.
 */
export async function applyCvTailorProposal(
  userId: string,
  proposal: unknown,
  opts: CvOptions = CV_TAILOR_BASE_OPTIONS,
): Promise<{ document: CvDocument; changes: CvTailorChange[]; changed: boolean } | null> {
  if (!(await cvTailorAllowedFor(userId))) return null;
  try {
    const cv = await buildUserCv(userId, opts);
    if (!cv) return null;
    const verified = verifyCvTailor(cv, proposal, { knownTerms: await loadKnownTerms(userId) });
    return verified.ok ? verified.value : null;
  } catch {
    return null;
  }
}
