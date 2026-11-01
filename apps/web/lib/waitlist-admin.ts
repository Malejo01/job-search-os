import { sql } from "drizzle-orm";
import { withUser } from "./db";
import {
  canCreateInvitations,
  createInvitation,
  NotInvitationAdminError,
  revokeInvitation,
} from "./invitations";

/**
 * Administración de la lista de espera (ronda 70), solo servidor. La app no tiene privilegios sobre la
 * tabla `waitlist`: todo pasa por waitlist_admin_* (packages/db/rls/0006_waitlist.sql). Dos barreras:
 * cada función de acá verifica ADMIN_EMAILS (como createInvitation) y la base exige además que el
 * usuario esté en `app_admins`. Nunca se loguea ni se devuelve la IP; el email no va a los logs.
 */

export class WaitlistEntryNotFoundError extends Error {
  constructor() {
    super("la persona no está en la lista de espera");
    this.name = "WaitlistEntryNotFoundError";
  }
}

/** Es admin en la app (ADMIN_EMAILS) pero su user_id no está en app_admins: falta habilitarla en la base. */
export class WaitlistNotEnabledInDbError extends Error {
  constructor() {
    super("la cuenta es admin en la app pero no está habilitada en la base (app_admins)");
    this.name = "WaitlistNotEnabledInDbError";
  }
}

/** Traduce la excepción "no autorizado" de waitlist_admin_* (mira toda la cadena de causas). */
async function guarded<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    for (let e: unknown = error; e && typeof e === "object"; e = (e as { cause?: unknown }).cause) {
      const message = (e as { message?: unknown }).message;
      if (typeof message === "string" && message.includes("waitlist_admin: no autorizado")) {
        throw new WaitlistNotEnabledInDbError();
      }
    }
    throw error;
  }
}

export class WaitlistAlreadyInvitedError extends Error {
  constructor() {
    super("esta persona ya tiene una invitación");
    this.name = "WaitlistAlreadyInvitedError";
  }
}

export type WaitlistEntry = {
  id: string;
  name: string;
  email: string;
  role: string;
  heardFrom: string | null;
  createdAt: Date;
  invitedAt: Date | null;
};

type ListRow = {
  id: string;
  name: string;
  email: string;
  role: string;
  heard_from: string | null;
  created_at: Date | string;
  invited_at: Date | string | null;
};

async function assertAdmin(userId: string): Promise<void> {
  if (!(await canCreateInvitations(userId))) throw new NotInvitationAdminError();
}

/** Sin invitar primero y por fecha; tope de 500 (lo impone la función). */
export async function listWaitlist(userId: string): Promise<WaitlistEntry[]> {
  await assertAdmin(userId);
  const rows = (await guarded(() =>
    withUser(userId, (tx) => tx.execute(sql`select * from public.waitlist_admin_list(500)`)),
  )) as unknown as ListRow[];
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    email: r.email,
    role: r.role,
    heardFrom: r.heard_from,
    createdAt: new Date(r.created_at),
    invitedAt: r.invited_at ? new Date(r.invited_at) : null,
  }));
}

/**
 * Crea la invitación atada al email de la persona y marca la fila. Devuelve lo mismo que la creación
 * de hoy: el código sale en claro una sola vez. No manda ningún email. Si la fila ya estaba invitada
 * no crea otra; si dos clics compiten, la invitación sobrante se revoca.
 */
export async function inviteFromWaitlist(
  userId: string,
  waitlistId: string,
): Promise<{ code: string; link: string | null; expiresAt: Date; email: string }> {
  await assertAdmin(userId);
  const [entry] = (await guarded(() =>
    withUser(userId, (tx) =>
      tx.execute(sql`select * from public.waitlist_admin_get(${waitlistId}::uuid)`),
    ),
  )) as unknown as { id: string; email: string; invited_at: Date | string | null }[];
  if (!entry) throw new WaitlistEntryNotFoundError();
  if (entry.invited_at) throw new WaitlistAlreadyInvitedError();

  const created = await createInvitation(userId, { email: entry.email });
  let changed: boolean;
  try {
    changed = await guarded(() =>
      withUser(userId, async (tx) => {
        const rows = (await tx.execute(
          sql`select public.waitlist_admin_mark_invited(${waitlistId}::uuid, ${created.id}::uuid) as changed`,
        )) as unknown as { changed: boolean }[];
        return rows[0]?.changed === true;
      }),
    );
  } catch (error) {
    // Sin marca la invitación quedaría suelta: se revoca y se relanza
    await revokeInvitation(userId, created.id);
    throw error;
  }
  if (!changed) {
    await revokeInvitation(userId, created.id);
    throw new WaitlistAlreadyInvitedError();
  }
  return {
    code: created.code,
    link: created.link,
    expiresAt: created.expiresAt,
    email: entry.email,
  };
}

/** Borrado a pedido de la persona; la función también borra su invitación si nadie la usó. Devuelve si había fila. */
export async function deleteFromWaitlist(userId: string, waitlistId: string): Promise<boolean> {
  await assertAdmin(userId);
  const rows = (await guarded(() =>
    withUser(userId, (tx) =>
      tx.execute(sql`select public.waitlist_admin_delete(${waitlistId}::uuid) as deleted`),
    ),
  )) as unknown as { deleted: boolean }[];
  return rows[0]?.deleted === true;
}

export type BulkInviteItem =
  | { id: string; ok: true; email: string; link: string; expiresAt: Date }
  | {
      id: string;
      ok: false;
      reason: "ya_invitada" | "no_esta" | "sin_link" | "error";
    };

/**
 * Invita a varias personas de la lista, una por vez (cada una es atómica: crea la invitación atada a su
 * email y marca la fila; ver `inviteFromWaitlist`). Un error en una persona no frena a las demás. El
 * llamador valida antes la cantidad contra el tope. No manda ningún email. Sin PII en los errores.
 */
export async function inviteManyFromWaitlist(
  userId: string,
  waitlistIds: readonly string[],
): Promise<BulkInviteItem[]> {
  await assertAdmin(userId);
  const out: BulkInviteItem[] = [];
  for (const id of waitlistIds) {
    try {
      const created = await inviteFromWaitlist(userId, id);
      if (!created.link) {
        // Sin URL base no hay link: la invitación quedó creada pero no se puede entregar
        out.push({ id, ok: false, reason: "sin_link" });
        continue;
      }
      out.push({
        id,
        ok: true,
        email: created.email,
        link: created.link,
        expiresAt: created.expiresAt,
      });
    } catch (error) {
      if (error instanceof WaitlistAlreadyInvitedError)
        out.push({ id, ok: false, reason: "ya_invitada" });
      else if (error instanceof WaitlistEntryNotFoundError)
        out.push({ id, ok: false, reason: "no_esta" });
      else if (
        error instanceof NotInvitationAdminError ||
        error instanceof WaitlistNotEnabledInDbError
      )
        throw error;
      else out.push({ id, ok: false, reason: "error" });
    }
  }
  return out;
}
