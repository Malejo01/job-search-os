import { schema as s, type Db } from "@job-search-os/db";
import {
  generateInvitationCode,
  hashInvitationCode,
  isInvitationAdmin,
  normalizeEmail,
} from "@job-search-os/db/invitation-code";
import { hashPassword } from "@job-search-os/db/password";
import { INBOUND_TOKEN_BYTES, tokenFromBytes } from "@job-search-os/pipeline";
import { eq, sql } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { maskEmail } from "./common";

/**
 * admin:test-users --create: cuentas de prueba por el MISMO camino que el registro real (invitación del
 * admin + `register_with_invitation_v3`, con casilla de ingesta y términos vigentes). Nada de INSERT a
 * mano en `users`. La contraseña es aleatoria, va solo a un archivo (`ops/test-users-credenciales.json`,
 * no versionado) y NUNCA a la terminal ni a los logs: este módulo no imprime nada y sus resultados no la
 * traen.
 *
 * Marca de prueba: después del registro, `users.is_test = true` (migración 0065). Las funciones de
 * métricas (rls/0020) y el aviso de vencimiento de plan la excluyen. Además, una cuenta recién
 * registrada está en plan gratis: la bienvenida sale solo de acciones de un admin y los cupos de fundador
 * solo cuentan planes asignados por un admin.
 */

export const CREDENTIALS_VERSION = 1;

export type Credentials = {
  version: number;
  accounts: Record<string, { password: string; createdAt: string }>;
};

/** Dónde se guardan las contraseñas. En pruebas, en memoria; en el CLI, en un archivo. */
export interface CredentialStore {
  has(email: string): boolean;
  save(email: string, password: string, createdAt: Date): void;
  drop(email: string): void;
}

/** Contraseña aleatoria fuerte: 24 bytes en base64url (192 bits, 32 caracteres). */
export function generatePassword(): string {
  return randomBytes(24).toString("base64url");
}

/** Lee `<INIT_CWD>/ops/test-users-credenciales.json`: la mala forma o la falta devuelven vacío. */
export function readCredentials(
  path: string,
  readFile: (p: string) => string = (p) => readFileSync(p, "utf8"),
): Credentials {
  try {
    const parsed = JSON.parse(readFile(path)) as Partial<Credentials>;
    if (
      parsed &&
      typeof parsed === "object" &&
      parsed.accounts &&
      typeof parsed.accounts === "object"
    ) {
      return { version: CREDENTIALS_VERSION, accounts: { ...parsed.accounts } };
    }
  } catch {
    // sin archivo o ilegible: se arranca vacío
  }
  return { version: CREDENTIALS_VERSION, accounts: {} };
}

/** Store de archivo: lee y escribe el JSON completo en cada cambio (pocas cuentas), con permisos 0600. */
export function fileCredentialStore(
  relativePath: string,
  env: Record<string, string | undefined> = process.env,
): CredentialStore & { path: string } {
  const path = resolve(env.INIT_CWD ?? process.cwd(), relativePath);
  const write = (data: Credentials): void => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
    try {
      chmodSync(path, 0o600);
    } catch {
      // Windows: los permisos POSIX no aplican
    }
  };
  return {
    path,
    has: (email) => normalizeEmail(email) in readCredentials(path).accounts,
    save(email, password, createdAt) {
      const data = readCredentials(path);
      data.accounts[normalizeEmail(email)] = { password, createdAt: createdAt.toISOString() };
      write(data);
    },
    drop(email) {
      if (!existsSync(path)) return;
      const data = readCredentials(path);
      delete data.accounts[normalizeEmail(email)];
      write(data);
    },
  };
}

/**
 * Versión de términos vigente, leída de `apps/web/lib/terms.ts` (única fuente: adapters no importa de
 * la web). Prueba la ruta desde la raíz del repo y desde `apps/web`/`packages/adapters`.
 */
export function readTermsVersion(
  env: Record<string, string | undefined> = process.env,
  readFile: (p: string) => string = (p) => readFileSync(p, "utf8"),
): { ok: true; version: string } | { ok: false; error: string } {
  const base = env.INIT_CWD ?? process.cwd();
  for (const rel of ["apps/web/lib/terms.ts", "lib/terms.ts", "../../apps/web/lib/terms.ts"]) {
    try {
      const match = /export const TERMS_VERSION = "(\d{4}-\d{2}-\d{2})"/.exec(
        readFile(resolve(base, rel)),
      );
      if (match) return { ok: true, version: match[1]! };
    } catch {
      // probar la siguiente ruta
    }
  }
  return {
    ok: false,
    error: "no se pudo leer TERMS_VERSION de apps/web/lib/terms.ts: correr desde la raíz del repo",
  };
}

export type CreateStatus = "creada" | "ya existe" | "omitida" | "error";
export type CreateRow = { email: string; status: CreateStatus; reason?: string };

/** Una línea por cuenta, con el email enmascarado. Nunca trae contraseñas ni códigos de invitación. */
export function formatCreateRow(row: CreateRow, showEmails: boolean): string {
  const who = showEmails ? row.email : maskEmail(row.email);
  return `${who}  ${row.status}${row.reason ? ` (${row.reason})` : ""}`;
}

export type CreateDeps = {
  by: string;
  termsVersion: string;
  store: CredentialStore;
  env?: Record<string, string | undefined>;
  now?: () => Date;
};

/**
 * Crea las cuentas de la allowlist que no existan. Idempotente: las que ya existen se saltean. Una cuenta
 * de ADMIN_EMAILS se omite. Si algo falla en una, se informa y se sigue con las demás.
 */
export async function createTestUsers(
  db: Db,
  allowlist: string[],
  deps: CreateDeps,
): Promise<{ ok: true; rows: CreateRow[] } | { ok: false; error: string }> {
  const env = deps.env ?? process.env;
  const now = deps.now ?? (() => new Date());
  const [admin] = await db
    .select({ id: s.users.id, email: s.users.email })
    .from(s.users)
    .where(eq(sql`lower(${s.users.email})`, normalizeEmail(deps.by)))
    .limit(1);
  if (!admin) return { ok: false, error: "no existe un usuario con el email de --by" };
  if (!isInvitationAdmin(admin.email, env.ADMIN_EMAILS)) {
    return { ok: false, error: "el usuario de --by no está en ADMIN_EMAILS" };
  }
  const ingestDomain = env.INGEST_DOMAIN ?? "ingest.local";

  const rows: CreateRow[] = [];
  for (const raw of allowlist) {
    const email = normalizeEmail(raw);
    if (isInvitationAdmin(email, env.ADMIN_EMAILS)) {
      rows.push({ email, status: "omitida", reason: "es de un admin (ADMIN_EMAILS)" });
      continue;
    }
    const [existing] = await db
      .select({ id: s.users.id })
      .from(s.users)
      .where(eq(sql`lower(${s.users.email})`, email))
      .limit(1);
    if (existing) {
      rows.push({
        email,
        status: "ya existe",
        reason: deps.store.has(email) ? undefined : "sin contraseña guardada: --reset y --create",
      });
      continue;
    }

    const password = generatePassword();
    // La contraseña se guarda ANTES de registrar: si el proceso se corta en el medio no queda una cuenta
    // sin credencial. Si el registro falla, se devuelve.
    deps.store.save(email, password, now());
    try {
      // Invitación del admin, atada al email (como la del panel), y canje por la función del registro real
      const { code } = generateInvitationCode();
      const codeHash = hashInvitationCode(code);
      await db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('app.user_id', ${admin.id}, true)`);
        await tx.insert(s.invitations).values({ codeHash, email, createdByUserId: admin.id });
      });
      const inboundLocal = tokenFromBytes(randomBytes(INBOUND_TOKEN_BYTES));
      const result = (await db.execute(
        sql`select register_with_invitation_v3(
          ${codeHash}, ${email}, ${hashPassword(password)},
          ${email.split("@")[0] ?? null}, ${ingestDomain}, ${deps.termsVersion}, ${inboundLocal}) as user_id`,
      )) as unknown as { user_id: string | null }[];
      const userId = result[0]?.user_id;
      if (!userId) throw new Error("el registro no devolvió usuario");
      // DESPUÉS del registro real, con la conexión de servicio de este CLI: la marca de prueba (T-1)
      try {
        await db.update(s.users).set({ isTest: true }).where(eq(s.users.id, userId));
      } catch {
        // La cuenta existe y su contraseña queda guardada, pero sin marca contaría en las métricas
        rows.push({
          email,
          status: "error",
          reason: "creada sin marca is_test: --reset-all y volver a crear",
        });
        continue;
      }
      rows.push({ email, status: "creada" });
    } catch {
      deps.store.drop(email);
      // Sin el texto de la excepción: puede traer el hash o el email
      rows.push({ email, status: "error", reason: "no se pudo registrar" });
    }
  }
  return { ok: true, rows };
}
