import { deleteUserData, schema as s, type Db } from "@job-search-os/db";
import { isInvitationAdmin } from "@job-search-os/db/invitation-code";
import { isProfileComplete } from "@job-search-os/pipeline";
import { eq, sql } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { maskEmail, normalizeEmail, parseEmail, type Parsed } from "./common";

/** admin:test-users — lista y resetea cuentas de prueba, solo las de una allowlist explícita. */

export const DEFAULT_ALLOWLIST = "ops/test-users.txt";

/** Credenciales de las cuentas creadas con --create: no se versiona (`ops/` está en .gitignore). */
export const DEFAULT_CREDENTIALS = "ops/test-users-credenciales.json";

export type TestUsersArgs = {
  mode:
    | { kind: "list" }
    | { kind: "reset"; email: string; force?: true }
    | { kind: "reset-all" }
    | { kind: "create"; by: string; credentials: string };
  allowlist: string;
  showEmails: boolean;
  yes: boolean;
  remote: boolean;
  /** Solo de --create: ADMIN_EMAILS explícito (lista normalizada). Con --remote es obligatorio. */
  adminEmails?: string;
  /** Solo de --create: INGEST_DOMAIN explícito (minúsculas). Con --remote es obligatorio. */
  ingestDomain?: string;
};

const DOMAIN_RE = /^(?=.{3,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

/** Las credenciales solo se escriben bajo `ops/` (no versionado): relativa, sin «..» ni unidades. */
export function isCredentialsPathAllowed(path: string): boolean {
  const norm = path.replace(/\\/g, "/");
  if (norm.startsWith("/") || /^[a-zA-Z]:/.test(norm)) return false;
  const parts = norm.split("/").filter((p) => p !== "" && p !== ".");
  return parts.length >= 2 && parts[0] === "ops" && !parts.includes("..");
}

export function parseTestUsersArgs(argv: string[]): Parsed<TestUsersArgs> {
  const usage =
    "uso: admin:test-users --list | --reset <email> | --reset-all | --create --by <email-admin> [--credentials <ruta>] [--allowlist <ruta>] [--admin-emails <lista> --ingest-domain <dominio>] [--show-emails] [--yes] [--remote] (con --create --remote, --admin-emails y --ingest-domain son obligatorios)";
  let values: {
    "admin-emails"?: string;
    "ingest-domain"?: string;
    list?: boolean;
    reset?: string;
    "reset-all"?: boolean;
    create?: boolean;
    by?: string;
    credentials?: string;
    force?: boolean;
    allowlist?: string;
    "show-emails"?: boolean;
    yes?: boolean;
    remote?: boolean;
  };
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        list: { type: "boolean" },
        reset: { type: "string" },
        "reset-all": { type: "boolean" },
        create: { type: "boolean" },
        by: { type: "string" },
        credentials: { type: "string" },
        force: { type: "boolean" },
        allowlist: { type: "string" },
        "show-emails": { type: "boolean" },
        yes: { type: "boolean" },
        remote: { type: "boolean" },
        "admin-emails": { type: "string" },
        "ingest-domain": { type: "string" },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch {
    return { ok: false, error: usage };
  }
  const modes = [
    values.list === true,
    values.reset !== undefined,
    values["reset-all"] === true,
    values.create === true,
  ].filter(Boolean).length;
  if (modes > 1) {
    return { ok: false, error: `--list, --reset, --reset-all y --create no se combinan. ${usage}` };
  }
  if ((values.by !== undefined || values.credentials !== undefined) && !values.create) {
    return { ok: false, error: `--by y --credentials son solo de --create. ${usage}` };
  }
  if (values.force && values.reset === undefined) {
    return { ok: false, error: `--force es solo de --reset. ${usage}` };
  }
  if (
    (values["admin-emails"] !== undefined || values["ingest-domain"] !== undefined) &&
    !values.create
  ) {
    return { ok: false, error: `--admin-emails y --ingest-domain son solo de --create. ${usage}` };
  }
  // ADMIN_EMAILS e INGEST_DOMAIN explícitos: contra la nube no se toman del entorno ni del .env.local
  let adminEmails: string | undefined;
  let ingestDomain: string | undefined;
  if (values["admin-emails"] !== undefined) {
    const list = values["admin-emails"].split(",").map((e) => e.trim());
    const parsed = list.map((e) => parseEmail(e));
    if (parsed.length === 0 || parsed.some((e) => e === null)) {
      return {
        ok: false,
        error: "--admin-emails: una lista de emails válidos separados por comas",
      };
    }
    adminEmails = [...new Set(parsed as string[])].join(",");
  }
  if (values["ingest-domain"] !== undefined) {
    const domain = values["ingest-domain"].trim().toLowerCase();
    if (!DOMAIN_RE.test(domain)) {
      return {
        ok: false,
        error: "--ingest-domain: un dominio válido (por ejemplo ingest.<tu-dominio>)",
      };
    }
    ingestDomain = domain;
  }
  if (values.create && values.remote && (adminEmails === undefined || ingestDomain === undefined)) {
    return {
      ok: false,
      error:
        "--create --remote no toma ADMIN_EMAILS ni INGEST_DOMAIN del entorno ni del .env.local: " +
        "pasá --admin-emails <lista> y --ingest-domain <dominio> explícitos",
    };
  }
  let mode: TestUsersArgs["mode"];
  if (values.list) {
    mode = { kind: "list" };
  } else if (values["reset-all"]) {
    mode = { kind: "reset-all" };
  } else if (values.create) {
    const by = parseEmail(values.by);
    if (!by) return { ok: false, error: "falta --by <email-admin> (con un email válido)" };
    const credentials = values.credentials?.trim() || DEFAULT_CREDENTIALS;
    if (!isCredentialsPathAllowed(credentials)) {
      return {
        ok: false,
        error: "--credentials solo acepta una ruta relativa bajo ops/ (sin «..»)",
      };
    }
    mode = { kind: "create", by, credentials };
  } else if (values.reset !== undefined) {
    const email = parseEmail(values.reset);
    if (!email) return { ok: false, error: "el email de --reset no es válido" };
    mode = { kind: "reset", email, ...(values.force ? { force: true as const } : {}) };
  } else {
    return { ok: false, error: usage };
  }
  return {
    ok: true,
    mode,
    allowlist: values.allowlist?.trim() || DEFAULT_ALLOWLIST,
    showEmails: values["show-emails"] === true,
    yes: values.yes === true,
    remote: values.remote === true,
    ...(adminEmails !== undefined ? { adminEmails } : {}),
    ...(ingestDomain !== undefined ? { ingestDomain } : {}),
  };
}

/**
 * Un email por línea. Normaliza (minúsculas, sin espacios), ignora líneas vacías y comentarios
 * con `#`. Las líneas que no son un email se ignoran: nunca amplían la lista.
 */
export function parseAllowlist(text: string): string[] {
  const emails = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const clean = line.replace(/#.*$/, "").trim();
    if (!clean) continue;
    const email = parseEmail(clean);
    if (email) emails.add(email);
  }
  return [...emails];
}

/**
 * Lee la allowlist. Relativa a `INIT_CWD` (donde se lanzó pnpm), no al paquete. Inexistente o sin
 * ningún email → error: sin allowlist no se toca nada.
 */
export function readAllowlist(
  path: string,
  env: Record<string, string | undefined> = process.env,
  readFile: (path: string) => string = (p) => readFileSync(p, "utf8"),
): { ok: true; emails: string[] } | { ok: false; error: string } {
  const full = resolve(env.INIT_CWD ?? process.cwd(), path);
  let text: string;
  try {
    text = readFile(full);
  } catch {
    return { ok: false, error: `no se pudo leer la allowlist (${path}): sin ella no se hace nada` };
  }
  const emails = parseAllowlist(text);
  if (emails.length === 0) {
    return { ok: false, error: `la allowlist (${path}) no tiene ningún email: no se hace nada` };
  }
  return { ok: true, emails };
}

export type TestUserRow = {
  email: string;
  exists: boolean;
  createdAt: Date | null;
  onboarded: boolean;
  jobs: number;
  evaluations: number;
  applications: number;
};

/** Estado de cada cuenta de la allowlist. «Onboarding completo» = lo mismo que el gate de la app (`isProfileComplete`). */
export async function listTestUsers(db: Db, emails: string[]): Promise<TestUserRow[]> {
  const rows: TestUserRow[] = [];
  for (const email of emails) {
    const [user] = await db
      .select({ id: s.users.id, createdAt: s.users.createdAt })
      .from(s.users)
      .where(eq(sql`lower(${s.users.email})`, email))
      .limit(1);
    if (!user) {
      rows.push({
        email,
        exists: false,
        createdAt: null,
        onboarded: false,
        jobs: 0,
        evaluations: 0,
        applications: 0,
      });
      continue;
    }
    // El mismo criterio que el gate de la app (`isOnboardingComplete`): país elegido, resumen y un criterio
    // activo. Una fila de perfil sola (la que crea el alta por invitación) no alcanza: cae en /onboarding.
    const [profile] = await db
      .select({
        locationCountry: s.profiles.locationCountry,
        profileSummary: s.profiles.profileSummary,
      })
      .from(s.profiles)
      .where(eq(s.profiles.userId, user.id))
      .limit(1);
    const [counts] = (await db.execute(sql`
      select
        (select count(*)::int from evaluation_criteria where user_id = ${user.id} and active) as criteria,
        (select count(*)::int from jobs where user_id = ${user.id}) as jobs,
        (select count(*)::int from evaluations where user_id = ${user.id}) as evaluations,
        (select count(*)::int from applications where user_id = ${user.id}) as applications
    `)) as unknown as {
      criteria: number;
      jobs: number;
      evaluations: number;
      applications: number;
    }[];
    rows.push({
      email,
      exists: true,
      createdAt: user.createdAt,
      onboarded: profile
        ? isProfileComplete({ ...profile, activeCriteriaCount: counts?.criteria ?? 0 })
        : false,
      jobs: counts?.jobs ?? 0,
      evaluations: counts?.evaluations ?? 0,
      applications: counts?.applications ?? 0,
    });
  }
  return rows;
}

export function formatTestUserRow(row: TestUserRow, showEmails: boolean): string {
  const who = showEmails ? row.email : maskEmail(row.email);
  if (!row.exists) return `${who}  no existe`;
  return (
    `${who}  alta ${row.createdAt!.toISOString().slice(0, 10)}  ` +
    `onboarding ${row.onboarded ? "completo" : "sin completar"}  ` +
    `jobs ${row.jobs}  evaluaciones ${row.evaluations}  postulaciones ${row.applications}`
  );
}

export type ResetResult =
  { ok: true; counts: Record<string, number> } | { ok: false; error: string };

/**
 * Borra los datos de UNA cuenta de la allowlist, con el mismo borrado que «Eliminar mi cuenta»
 * (deleteUserData), en una transacción con `app.user_id` fijado. No recrea la cuenta.
 */
export async function resetTestUser(
  db: Db,
  email: string,
  allowlist: string[],
  adminEmails: string | undefined = process.env.ADMIN_EMAILS,
  options: { force?: boolean } = {},
): Promise<ResetResult> {
  const wanted = normalizeEmail(email);
  // Este es el chequeo de seguridad real (el del CLI solo adelanta el error): no borrarlo
  if (!allowlist.map(normalizeEmail).includes(wanted)) {
    return { ok: false, error: "ese email no está en la allowlist: no se borra nada" };
  }
  // Una allowlist equivocada nunca borra la cuenta de un admin
  if (isInvitationAdmin(wanted, adminEmails)) {
    return { ok: false, error: "ese email es de un admin (ADMIN_EMAILS): no se borra nada" };
  }
  const [user] = await db
    .select({ id: s.users.id, isTest: s.users.isTest })
    .from(s.users)
    .where(eq(sql`lower(${s.users.email})`, wanted))
    .limit(1);
  if (!user) return { ok: false, error: "no existe una cuenta con ese email" };
  // Una allowlist equivocada no borra a una persona real: solo cuentas marcadas is_test, o --force explícito
  if (!user.isTest && !options.force) {
    return {
      ok: false,
      error:
        "la cuenta no está marcada como de prueba (is_test): no se borra; con --reset <email> --force sí",
    };
  }
  const counts = await db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.user_id', ${user.id}, true)`);
    return deleteUserData(tx, user.id);
  });
  return { ok: true, counts };
}

/** Frase que hay que escribir para `--reset-all`: una sola confirmación para todas las cuentas. */
export const RESET_ALL_PHRASE = "borrar cuentas de prueba";

export type ResetAllRow = {
  email: string;
  status: "borrada" | "no existe" | "omitida";
  rows: number;
  /** Solo si se omitió: por qué. */
  reason?: string;
};

/**
 * Borra todas las cuentas de la allowlist que existan (mismo borrado que `resetTestUser`, una por una).
 * Las que no existen se informan y se siguen; un admin de ADMIN_EMAILS se omite, nunca se borra.
 */
export async function resetAllTestUsers(
  db: Db,
  allowlist: string[],
  adminEmails: string | undefined = process.env.ADMIN_EMAILS,
): Promise<ResetAllRow[]> {
  const out: ResetAllRow[] = [];
  for (const email of allowlist) {
    const res = await resetTestUser(db, email, allowlist, adminEmails);
    if (res.ok) {
      out.push({
        email,
        status: "borrada",
        rows: Object.values(res.counts).reduce((a, b) => a + b, 0),
      });
    } else if (res.error.startsWith("no existe")) {
      out.push({ email, status: "no existe", rows: 0 });
    } else {
      out.push({ email, status: "omitida", rows: 0, reason: res.error });
    }
  }
  return out;
}
