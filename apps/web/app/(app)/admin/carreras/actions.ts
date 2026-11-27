"use server";

import { createLogger } from "@job-search-os/adapters";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdminOrThrow } from "@/lib/admin-guard";
import { CareerAdminNotEnabledInDbError, setCareerOpen } from "@/lib/careers-open";
import { NotInvitationAdminError } from "@/lib/invitations";
import { requireActiveUserId } from "@/lib/session";

const BACK = "/admin/carreras";

/**
 * Abre o cierra una carrera de la beta (R32-03). Server Action nueva, solo admins: el usuario sale de la sesión
 * (nunca del formulario), se comprueba en el servidor (`ADMIN_EMAILS`) y la base lo vuelve a exigir
 * (`app_admins`). Solo claves del catálogo: «Otra» nunca abre. Cada cambio real queda en el historial con quién y
 * cuándo (lo escribe la función de la base, no esta acción). Vuelve a la pantalla con un código corto en la URL.
 */
export async function setCareerOpenAction(formData: FormData): Promise<void> {
  const userId = await requireActiveUserId();
  const career = formData.get("career");
  const open = formData.get("open") === "si";
  let target: string;
  try {
    await requireAdminOrThrow(userId);
    const result = await setCareerOpen(userId, career, open);
    target =
      result === "ok"
        ? `${BACK}?ok=${open ? "abierta" : "cerrada"}`
        : result === "sin_cambio"
          ? `${BACK}?ok=sin_cambio`
          : `${BACK}?error=invalida`;
    if (result === "ok") {
      // Solo el id del admin, la carrera y el sentido del cambio
      createLogger({ user_id: userId, task: "admin_career_open" }).info(
        { career, open },
        "apertura por carrera cambiada",
      );
    }
  } catch (error) {
    if (error instanceof NotInvitationAdminError) target = `${BACK}?error=no_admin`;
    else if (error instanceof CareerAdminNotEnabledInDbError) target = `${BACK}?error=sin_base`;
    else target = `${BACK}?error=fallo`;
  }
  revalidatePath(BACK);
  redirect(target);
}
