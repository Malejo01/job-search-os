import { schema as s, type Db } from "@job-search-os/db";
import {
  generateInvitationCode,
  isInvitationAdmin,
  normalizeEmail,
} from "@job-search-os/db/invitation-code";
import { eq, sql } from "drizzle-orm";
import { parseArgs } from "node:util";
import { resetUrlBase } from "../auth/reset-url";
import { parseEmail, type Parsed } from "./common";

/** admin:invite — crea una invitación sin pasar por la app (mismo efecto que createInvitation). */

export type InviteArgs = { by: string; email: string | null; remote: boolean };

export function parseInviteArgs(argv: string[]): Parsed<InviteArgs> {
  let values: { by?: string; email?: string; remote?: boolean };
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        by: { type: "string" },
        email: { type: "string" },
        remote: { type: "boolean" },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch {
    return {
      ok: false,
      error: "uso: admin:invite [--email <email>] --by <email-admin> [--remote]",
    };
  }
  const by = parseEmail(values.by);
  if (!by) return { ok: false, error: "falta --by <email-admin> (con un email válido)" };
  let email: string | null = null;
  if (values.email !== undefined) {
    email = parseEmail(values.email);
    if (!email) return { ok: false, error: "el email de --email no es válido" };
  }
  return { ok: true, by, email, remote: values.remote === true };
}

export type InviteResult =
  | { ok: true; id: string; code: string; link: string | null; expiresAt: Date }
  | { ok: false; error: string };

/**
 * Busca al admin por email, exige que esté en ADMIN_EMAILS e inserta la invitación en una
 * transacción con `app.user_id` fijado (vale la policy RLS de `invitations`). El TTL es el
 * default de la columna (14 días), igual que createInvitation.
 */
export async function createInvitationAsAdmin(
  db: Db,
  input: { by: string; email: string | null },
  env: Record<string, string | undefined> = process.env,
): Promise<InviteResult> {
  const [admin] = await db
    .select({ id: s.users.id, email: s.users.email })
    .from(s.users)
    .where(eq(sql`lower(${s.users.email})`, normalizeEmail(input.by)))
    .limit(1);
  if (!admin) return { ok: false, error: "no existe un usuario con el email de --by" };
  if (!isInvitationAdmin(admin.email, env.ADMIN_EMAILS)) {
    return { ok: false, error: "el usuario de --by no está en ADMIN_EMAILS" };
  }
  const { code, codeHash } = generateInvitationCode();
  const row = await db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.user_id', ${admin.id}, true)`);
    const [inserted] = await tx
      .insert(s.invitations)
      .values({ codeHash, email: input.email, createdByUserId: admin.id })
      .returning({ id: s.invitations.id, expiresAt: s.invitations.expiresAt });
    return inserted!;
  });
  // URL base solo de la configuración (SEC-05)
  const base = resetUrlBase(env);
  return {
    ok: true,
    id: row.id,
    code,
    link: base.ok ? `${base.url}/register?code=${code}` : null,
    expiresAt: row.expiresAt,
  };
}
