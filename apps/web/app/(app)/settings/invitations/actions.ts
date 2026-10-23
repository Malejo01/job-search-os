"use server";

import { createLogger } from "@job-search-os/adapters";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createInvitation, NotInvitationAdminError, revokeInvitation } from "@/lib/invitations";
import { isValidEmail, normalizeEmail } from "@/lib/invitations-core";
import { requireActiveUserId } from "@/lib/session";
import {
  deleteFromWaitlist,
  inviteFromWaitlist,
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
      message: "Falta AUTH_URL o NEXT_PUBLIC_APP_URL: no se puede armar el link.",
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
        message: "Falta AUTH_URL o NEXT_PUBLIC_APP_URL: no se puede armar el link.",
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
