import { z } from "zod";
import { err, ok, type Result } from "../result";

/**
 * Archivo de datos del candidato (JS-053): `fixtures-private/applicant.json` con los datos reales,
 * `packages/db/seeds/applicant.example.json` en el repo. Lo edita la persona y lo carga
 * `pnpm applicant:sync`; ningún modelo escribe hechos. Acá solo validación y plan del diff.
 */
export const FACT_VERIFICATION = ["verificable", "autodeclarado"] as const;
export type FactVerification = (typeof FACT_VERIFICATION)[number];

const nonBlank = z.string().trim().min(1);

const factSchema = z.object({
  key: nonBlank,
  project: nonBlank,
  claim: nonBlank,
  metric: nonBlank.nullable().optional(),
  source: nonBlank,
  verification: z.enum(FACT_VERIFICATION).default("verificable"),
  sort: z.number().int().optional(),
});

const fileSchema = z.object({
  settings: z.object({
    availability: nonBlank.nullable().optional(),
    contract: nonBlank.nullable().optional(),
    work_authorization: nonBlank.nullable().optional(),
    links: z
      .object({
        linkedin: z.url().optional(),
        github: z.url().optional(),
        portfolio: z.url().optional(),
        cv: z.url().optional(),
      })
      .strict()
      .default({}),
  }),
  facts: z.array(factSchema),
});

export type FactInput = {
  key: string;
  project: string;
  claim: string;
  metric: string | null;
  source: string;
  verification: FactVerification;
  sort: number;
};
export type FactRow = FactInput & { active: boolean };

export type ApplicantFile = {
  settings: {
    availability: string | null;
    contract: string | null;
    workAuthorization: string | null;
    links: { linkedin?: string; github?: string; portfolio?: string; cv?: string };
  };
  facts: FactInput[];
};

/** Marca de hueco en el borrador: applicant:sync no carga un archivo que la tenga. */
export const PENDING = "COMPLETAR";

function pendingPaths(value: unknown, path: string[] = []): string[] {
  if (typeof value === "string") return value.includes(PENDING) ? [path.join(".")] : [];
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) => pendingPaths(v, [...path, k]));
  }
  return [];
}

export function parseApplicantFile(input: unknown): Result<ApplicantFile, string[]> {
  const parsed = fileSchema.safeParse(input);
  if (!parsed.success) {
    return err(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
  }
  const { settings, facts } = parsed.data;
  const seen = new Set<string>();
  const dup = facts.map((f) => f.key).filter((k) => (seen.has(k) ? true : (seen.add(k), false)));
  if (dup.length) return err(dup.map((k) => `clave repetida en facts: ${k}`));
  // Un borrador con huecos marcados no se carga: mejor ningún hecho que uno a medio escribir
  const pending = pendingPaths(parsed.data);
  if (pending.length) return err(pending.map((p) => `${p}: falta completar (${PENDING})`));
  return ok({
    settings: {
      availability: settings.availability ?? null,
      contract: settings.contract ?? null,
      workAuthorization: settings.work_authorization ?? null,
      links: settings.links,
    },
    facts: facts.map((f, i) => ({
      key: f.key,
      project: f.project,
      claim: f.claim,
      metric: f.metric ?? null,
      source: f.source,
      verification: f.verification,
      sort: f.sort ?? i,
    })),
  });
}

const COMPARED = ["project", "claim", "metric", "source", "verification", "sort"] as const;
type FactField = (typeof COMPARED)[number] | "active";

export type FactsSyncPlan = {
  insert: FactInput[];
  update: { key: string; fact: FactInput; fields: FactField[] }[];
  /** Claves que ya no están en el archivo: se desactivan, no se borran. */
  deactivate: string[];
  unchanged: number;
};

export function planFactsSync(
  current: readonly FactRow[],
  desired: readonly FactInput[],
): FactsSyncPlan {
  const byKey = new Map(current.map((r) => [r.key, r]));
  const wanted = new Set(desired.map((f) => f.key));
  const plan: FactsSyncPlan = { insert: [], update: [], deactivate: [], unchanged: 0 };

  for (const fact of desired) {
    const existing = byKey.get(fact.key);
    if (!existing) {
      plan.insert.push(fact);
      continue;
    }
    const fields: FactField[] = COMPARED.filter((f) => existing[f] !== fact[f]);
    if (!existing.active) fields.push("active");
    if (fields.length) plan.update.push({ key: fact.key, fact, fields });
    else plan.unchanged += 1;
  }
  for (const r of current) {
    if (wanted.has(r.key)) continue;
    if (r.active) plan.deactivate.push(r.key);
    else plan.unchanged += 1;
  }
  return plan;
}
