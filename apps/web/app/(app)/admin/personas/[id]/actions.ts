"use server";

import { createLogger } from "@job-search-os/adapters";
import type { PersonAction } from "@job-search-os/pipeline";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdminOrThrow } from "@/lib/admin-guard";
import { setBlocked, setTestAccount, setTester } from "@/lib/people-admin";
import { requireActiveUserId } from "@/lib/session";

/**
 * Acciones de la ficha de una persona (ADM-1): rol tester, bloqueo y cuenta de prueba. Cada una vuelve a
 * comprobar el rol en el servidor (además de la barrera `app_admins` de la base) y vuelve a la ficha con
 * el resultado en la URL: `a` (acción) y `r` (lo que devolvió la base). Nunca el email en la URL ni en el log.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ACTIONS: Record<PersonAction, (adminId: string, personId: string) => Promise<string>> = {
  tester_si: (a, p) => setTester(a, p, true),
  tester_no: (a, p) => setTester(a, p, false),
  bloquear: (a, p) => setBlocked(a, p, true),
  desbloquear: (a, p) => setBlocked(a, p, false),
  prueba_si: (a, p) => setTestAccount(a, p, true),
  prueba_no: (a, p) => setTestAccount(a, p, false),
};

function isPersonAction(v: unknown): v is PersonAction {
  return typeof v === "string" && Object.hasOwn(ACTIONS, v);
}

export async function personAction(formData: FormData): Promise<void> {
  const adminId = await requireActiveUserId();
  const personId = String(formData.get("id") ?? "");
  const action = formData.get("accion");
  if (!UUID.test(personId)) redirect("/admin/personas");
  const back = `/admin/personas/${personId}`;
  if (!isPersonAction(action)) redirect(`${back}?r=invalida`);
  let result: string;
  try {
    await requireAdminOrThrow(adminId);
    result = await ACTIONS[action](adminId, personId);
    createLogger({ user_id: adminId, task: "admin_person" }).info(
      { action, result },
      "cambio de una persona desde el panel",
    );
  } catch {
    result = "error";
  }
  revalidatePath(back);
  revalidatePath("/admin/personas");
  redirect(`${back}?a=${action}&r=${encodeURIComponent(result)}`);
}
