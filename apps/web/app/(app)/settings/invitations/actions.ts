"use server";

import { revalidatePath } from "next/cache";
import { createInvitation, NotInvitationAdminError, revokeInvitation } from "@/lib/invitations";
import { isValidEmail, normalizeEmail } from "@/lib/invitations-core";
import { requireUserId } from "@/lib/session";

export type CreateInvitationState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "created"; link: string; email: string | null; expiresAt: string };

/** Crea la invitación y devuelve el link: es la única vez que el código en claro sale del servidor. */
export async function createInvitationAction(
  _prev: CreateInvitationState,
  formData: FormData,
): Promise<CreateInvitationState> {
  const userId = await requireUserId();
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

export async function revokeInvitationAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  await revokeInvitation(userId, String(formData.get("id") ?? ""));
  revalidatePath("/settings/invitations");
}
