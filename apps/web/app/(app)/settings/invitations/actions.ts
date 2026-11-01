"use server";

import { createLogger } from "@job-search-os/adapters";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  buildWaitlistInvitationText,
  clampInviteCap,
  INVITE_CAP_MAX,
} from "@job-search-os/pipeline";
import { createInvitation, NotInvitationAdminError, revokeInvitation } from "@/lib/invitations";
import { isValidEmail, normalizeEmail } from "@/lib/invitations-core";
import { requireActiveUserId } from "@/lib/session";
import {
  deleteFromWaitlist,
  inviteFromWaitlist,
  inviteManyFromWaitlist,
  WaitlistAlreadyInvitedError,
  WaitlistEntryNotFoundError,
  WaitlistNotEnabledInDbError,
} from "@/lib/waitlist-admin";

export type CreateInvitationState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "created"; link: string; email: string | null; expiresAt: string };

/** Crea la invitación y devuelve el link: es la única vez que el código en claro sale del servidor. */
export async function createInvitationAction(
  _prev: CreateInvitationState,
  formData: FormData,
): Promise<CreateInvitationState> {
  const userId = await requireActiveUserId();
  const email = String(formData.get("email") ?? "").trim();
  if (email && !isValidEmail(email)) return { status: "error", message: "El email no es válido." };
  let created;
  try {
    created = await createInvitation(userId, { email: email || undefined });
  } catch (error) {
    if (error instanceof NotInvitationAdminError) {
      return { status: "error", message: "Tu cuenta no puede crear invitaciones." };
    }
    throw error;
  }
  revalidatePath("/settings/invitations");
  if (!created.link) {
    return {
      status: "error",
      message: "Falta SITE_URL (o AUTH_URL / NEXT_PUBLIC_APP_URL): no se puede armar el link.",
    };
  }
  return {
    status: "created",
    link: created.link,
    email: email ? normalizeEmail(email) : null,
    expiresAt: created.expiresAt.toISOString(),
  };
}

export type WaitlistInviteState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "created"; link: string; email: string; expiresAt: string };

const WaitlistIdSchema = z.string().uuid();

/** Invitación desde la lista de espera: atada al email de la fila. No manda ningún email. */
export async function inviteFromWaitlistAction(
  _prev: WaitlistInviteState,
  formData: FormData,
): Promise<WaitlistInviteState> {
  const userId = await requireActiveUserId();
  const id = WaitlistIdSchema.safeParse(formData.get("id"));
  if (!id.success) return { status: "error", message: "La persona no es válida." };
  try {
    const created = await inviteFromWaitlist(userId, id.data);
    revalidatePath("/settings/invitations");
    if (!created.link) {
      return {
        status: "error",
        message: "Falta SITE_URL (o AUTH_URL / NEXT_PUBLIC_APP_URL): no se puede armar el link.",
      };
    }
    return {
      status: "created",
      link: created.link,
      email: created.email,
      expiresAt: created.expiresAt.toISOString(),
    };
  } catch (error) {
    if (error instanceof NotInvitationAdminError) {
      return { status: "error", message: "Tu cuenta no puede crear invitaciones." };
    }
    if (error instanceof WaitlistNotEnabledInDbError) {
      return { status: "error", message: "Tu cuenta no está habilitada en la base." };
    }
    if (error instanceof WaitlistAlreadyInvitedError) {
      revalidatePath("/settings/invitations");
      return { status: "error", message: "Esta persona ya tiene una invitación." };
    }
    if (error instanceof WaitlistEntryNotFoundError) {
      revalidatePath("/settings/invitations");
      return { status: "error", message: "La persona ya no está en la lista." };
    }
    // Sin PII: solo el tipo de error y el id de la fila (nunca el email)
    createLogger({ task: "waitlist_invite", user_id: userId }).error(
      { waitlistId: id.data, err: error instanceof Error ? error.name : "unknown" },
      "no se pudo invitar desde la lista de espera",
    );
    return { status: "error", message: "No se pudo crear la invitación. Probá de nuevo." };
  }
}

export type BulkInviteResult =
  | { status: "error"; message: string }
  | {
      status: "done";
      items: (
        | { id: string; ok: true; email: string; message: string }
        | { id: string; ok: false; reason: "ya_invitada" | "no_esta" | "sin_link" | "error" }
      )[];
    };

const BulkInviteSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(INVITE_CAP_MAX),
  cap: z.union([z.string(), z.number()]).optional(),
  /** Nombre por id para el saludo del mensaje; lo que mande el cliente solo afecta el texto. */
  names: z.record(z.string().uuid(), z.string().max(120)).optional(),
});

/**
 * Invita a las personas elegidas en el panel (C4-2). Tope por tanda: el que configura el panel, entre 1 y
 * 100 (default 20, o `WAITLIST_INVITE_CAP`). Cada invitación queda atada al email de la persona y el link
 * sale una sola vez, ya dentro del mensaje listo para copiar (con «la beta abre el jueves 26/11»).
 * No manda ningún email.
 */
export async function inviteSelectedFromWaitlistAction(input: {
  ids: string[];
  cap?: string | number;
  names?: Record<string, string>;
}): Promise<BulkInviteResult> {
  const userId = await requireActiveUserId();
  const parsed = BulkInviteSchema.safeParse(input);
  if (!parsed.success) return { status: "error", message: "La selección no es válida." };
  const ids = [...new Set(parsed.data.ids)];
  const cap = clampInviteCap(parsed.data.cap, process.env.WAITLIST_INVITE_CAP);
  if (ids.length > cap) {
    return {
      status: "error",
      message: `Elegiste ${ids.length} personas y el tope de esta tanda es ${cap}.`,
    };
  }
  try {
    const items = await inviteManyFromWaitlist(userId, ids);
    revalidatePath("/settings/invitations");
    createLogger({ task: "waitlist_bulk_invite", user_id: userId }).info(
      { requested: ids.length, created: items.filter((i) => i.ok).length },
      "invitaciones desde la lista de espera",
    );
    return {
      status: "done",
      items: items.map((item) =>
        item.ok
          ? {
              id: item.id,
              ok: true as const,
              email: item.email,
              message: buildWaitlistInvitationText({
                name: parsed.data.names?.[item.id] ?? "",
                link: item.link,
                expiresAt: item.expiresAt,
              }),
            }
          : item,
      ),
    };
  } catch (error) {
    if (error instanceof NotInvitationAdminError) {
      return { status: "error", message: "Tu cuenta no puede crear invitaciones." };
    }
    if (error instanceof WaitlistNotEnabledInDbError) {
      return { status: "error", message: "Tu cuenta no está habilitada en la base." };
    }
    createLogger({ task: "waitlist_bulk_invite", user_id: userId }).error(
      { err: error instanceof Error ? error.name : "unknown" },
      "no se pudo invitar desde la lista de espera",
    );
    return { status: "error", message: "No se pudo crear las invitaciones. Probá de nuevo." };
  }
}

export type WaitlistDeleteState = { status: "idle" } | { status: "error"; message: string };

export async function deleteFromWaitlistAction(
  _prev: WaitlistDeleteState,
  formData: FormData,
): Promise<WaitlistDeleteState> {
  const userId = await requireActiveUserId();
  const id = WaitlistIdSchema.safeParse(formData.get("id"));
  if (!id.success) return { status: "error", message: "La persona no es válida." };
  try {
    await deleteFromWaitlist(userId, id.data);
  } catch (error) {
    if (error instanceof NotInvitationAdminError || error instanceof WaitlistNotEnabledInDbError) {
      return { status: "error", message: "Tu cuenta no puede borrar de la lista." };
    }
    createLogger({ task: "waitlist_delete", user_id: userId }).error(
      { waitlistId: id.data, err: error instanceof Error ? error.name : "unknown" },
      "no se pudo borrar de la lista de espera",
    );
    return { status: "error", message: "No se pudo borrar. Probá de nuevo." };
  }
  revalidatePath("/settings/invitations");
  return { status: "idle" };
}

export async function revokeInvitationAction(formData: FormData): Promise<void> {
  const userId = await requireActiveUserId();
  await revokeInvitation(userId, String(formData.get("id") ?? ""));
  revalidatePath("/settings/invitations");
}
