import { resetUrlBase } from "@job-search-os/adapters";
import { schema as s } from "@job-search-os/db";
import { hashPassword } from "@job-search-os/db/password";
import { and, desc, eq, sql } from "drizzle-orm";
import { getAppDb, withUser } from "./db";
import {
  generateInvitationCode,
  hashInvitationCode,
  invitationStatus,
  INVALID_INVITATION_MESSAGE,
  isInvitationAdmin,
  isValidEmail,
  normalizeEmail,
  validateRegistration,
  type InvitationStatus,
  type RegistrationInput,
} from "./invitations-core";
import { validateTermsAcceptance } from "./terms";

/** Registro por invitación (JS-091): superficie pública, ver packages/db/rls/0001_invitations.sql. */

export class NotInvitationAdminError extends Error {
  constructor() {
    super("solo los administradores pueden crear invitaciones");
    this.name = "NotInvitationAdminError";
  }
}

/** ¿Puede este usuario crear invitaciones? (su email está en ADMIN_EMAILS). Para la página. */
export async function canCreateInvitations(userId: string): Promise<boolean> {
  const [me] = await withUser(userId, (tx) =>
    tx.select({ email: s.users.email }).from(s.users).where(eq(s.users.id, userId)).limit(1),
  );
  return isInvitationAdmin(me?.email, process.env.ADMIN_EMAILS);
}

/**
 * Crea una invitación del usuario. Devuelve el código en claro UNA vez: en la base queda solo el
 * sha256. `email` opcional: si viene, solo ese email puede canjearla.
 */
export async function createInvitation(
  userId: string,
  options: { email?: string } = {},
): Promise<{ id: string; code: string; link: string | null; expiresAt: Date }> {
  const email = options.email?.trim() ? normalizeEmail(options.email) : null;
  if (email && !isValidEmail(email)) throw new Error("el email de la invitación no es válido");
  const { code, codeHash } = generateInvitationCode();
  const [row] = await withUser(userId, async (tx) => {
    // Solo los admins (ADMIN_EMAILS) crean invitaciones: se chequea acá, no en la página
    const [me] = await tx
      .select({ email: s.users.email })
      .from(s.users)
      .where(eq(s.users.id, userId))
      .limit(1);
    if (!isInvitationAdmin(me?.email, process.env.ADMIN_EMAILS))
      throw new NotInvitationAdminError();
    return tx
      .insert(s.invitations)
      .values({ codeHash, email, createdByUserId: userId })
      .returning({ id: s.invitations.id, expiresAt: s.invitations.expiresAt });
  });
  // URL base solo de la configuración, nunca de Host/x-forwarded-* (SEC-05)
  const base = resetUrlBase();
  return {
    id: row!.id,
    code,
    link: base.ok ? `${base.url}/register?code=${code}` : null,
    expiresAt: row!.expiresAt,
  };
}

export type InvitationRow = {
  id: string;
  email: string | null;
  createdAt: Date;
  expiresAt: Date;
  usedAt: Date | null;
  status: InvitationStatus;
};

/** Las invitaciones que creó el usuario (la policy RLS ya filtra por dueño); nunca incluye el código. */
export async function listInvitations(
  userId: string,
  now: Date = new Date(),
): Promise<InvitationRow[]> {
  const rows = await withUser(userId, (tx) =>
    tx
      .select({
        id: s.invitations.id,
        email: s.invitations.email,
        createdAt: s.invitations.createdAt,
        expiresAt: s.invitations.expiresAt,
        usedAt: s.invitations.usedAt,
      })
      .from(s.invitations)
      .where(eq(s.invitations.createdByUserId, userId))
      .orderBy(desc(s.invitations.createdAt)),
  );
  return rows.map((r) => ({ ...r, status: invitationStatus(r, now) }));
}

/** Revoca (borra) una invitación pendiente propia; una ya usada queda como registro. */
export async function revokeInvitation(userId: string, id: string): Promise<boolean> {
  const deleted = await withUser(userId, (tx) =>
    tx
      .delete(s.invitations)
      .where(
        and(
          eq(s.invitations.id, id),
          eq(s.invitations.createdByUserId, userId),
          sql`${s.invitations.usedAt} is null`,
        ),
      )
      .returning({ id: s.invitations.id }),
  );
  return deleted.length > 0;
}

export class InvalidInvitationError extends Error {
  constructor() {
    super(INVALID_INVITATION_MESSAGE);
    this.name = "InvalidInvitationError";
  }
}

export class InvalidRegistrationError extends Error {
  constructor(readonly reason: "email" | "password" | "name" | "terminos") {
    super(`registro inválido: ${reason}`);
    this.name = "InvalidRegistrationError";
  }
}

function isUniqueViolation(error: unknown): boolean {
  for (let e: unknown = error; e && typeof e === "object"; e = (e as { cause?: unknown }).cause) {
    if ((e as { code?: unknown }).code === "23505") return true;
  }
  return false;
}

/**
 * Canje + alta del usuario en UNA llamada atómica (register_with_invitation_v2, SECURITY DEFINER):
 * si algo falla, la invitación no queda gastada. Error genérico para inexistente / usada /
 * vencida / de otro email / email ya registrado: quien prueba códigos no aprende nada.
 * `termsAccepted` es el valor crudo de la casilla: sin aceptar no se registra (JS-106) y se guarda
 * la versión vigente de los términos junto con la fecha.
 */
export async function registerWithInvitation(
  input: RegistrationInput,
  termsAccepted: unknown,
): Promise<{ userId: string }> {
  const check = validateRegistration(input);
  if (!check.ok) {
    if (check.reason === "code") throw new InvalidInvitationError();
    throw new InvalidRegistrationError(check.reason);
  }
  const terms = validateTermsAcceptance(termsAccepted);
  if (!terms.ok) throw new InvalidRegistrationError(terms.reason);
  const codeHash = hashInvitationCode(input.code);
  const email = normalizeEmail(input.email);
  // Pre-chequeo barato (solo lectura): un código que no sirve no gasta scrypt
  const [pre] = (await getAppDb().execute(
    sql`select invitation_is_redeemable(${codeHash}, ${email}) as ok`,
  )) as unknown as { ok: boolean }[];
  if (!pre?.ok) throw new InvalidInvitationError();
  const passwordHash = hashPassword(input.password);
  const ingestDomain = process.env.INGEST_DOMAIN ?? "ingest.local";
  let userId: string | null;
  try {
    const rows = (await getAppDb().execute(
      sql`select register_with_invitation_v2(
        ${codeHash}, ${email}, ${passwordHash},
        ${input.name?.trim() || null}, ${ingestDomain}, ${terms.version}) as user_id`,
    )) as unknown as { user_id: string | null }[];
    userId = rows[0]?.user_id ?? null;
  } catch (error) {
    if (isUniqueViolation(error)) throw new InvalidInvitationError();
    throw error;
  }
  if (!userId) throw new InvalidInvitationError();
  return { userId };
}
