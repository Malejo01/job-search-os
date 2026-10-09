"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { FILTERS_COOKIE, FILTERS_COOKIE_MAX_AGE } from "@/lib/assistant-state";
import { markInboundSeen } from "@/lib/inbox-list";
import { requireUserId } from "@/lib/session";

function refresh() {
  revalidatePath("/onboarding/asistente");
  revalidatePath("/settings/asistente");
  revalidatePath("/inbox");
}

/** «Ya lo confirmé»: marca visto el pedido de Gmail (la misma regla que el botón de /inbox). */
export async function confirmedForwardingAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await markInboundSeen(userId, id);
  refresh();
}

/**
 * «Ya importé los filtros»: cookie `httpOnly` de un año con el id del usuario. Es solo UX, no un
 * dato: si se pierde, la persona vuelve a ver el paso de los filtros.
 */
export async function filtersImportedAction(): Promise<void> {
  const userId = await requireUserId();
  const jar = await cookies();
  jar.set(FILTERS_COOKIE, userId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: FILTERS_COOKIE_MAX_AGE,
  });
  refresh();
}
