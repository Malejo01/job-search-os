"use server";

import { createLogger, safeDbError } from "@job-search-os/adapters";
import { parseCareerChoice } from "@job-search-os/pipeline";
import { revalidatePath } from "next/cache";
import { markCareerPromptAsked, saveCareerFromPrompt } from "@/lib/career-prompt";
import { reassignForRoleChange } from "@/lib/pool-reassign";
import { requireActiveUserId } from "@/lib/session";

/**
 * Recuadro «¿Cuál es tu carrera?» (R32-01) para cuentas que no la cargaron. Server Actions nuevas: el usuario
 * sale de la sesión (nunca del formulario), la elección se valida en el servidor (una de las ocho de la beta o
 * «Otra» con su texto) y se escribe solo si la cuenta sigue sin carrera. No redirige: la persona se queda en la
 * pantalla en la que estaba y el recuadro desaparece al revalidar el layout.
 */
export type CareerPromptState =
  | { status: "idle" }
  | { status: "done" }
  | {
      status: "error";
      field: "career" | "careerOther" | "fallo";
      reason?: "corta" | "larga" | "caracteres";
    };

export async function saveCareerPromptAction(
  _prev: CareerPromptState,
  formData: FormData,
): Promise<CareerPromptState> {
  const userId = await requireActiveUserId();
  const parsed = parseCareerChoice({
    career: formData.get("career"),
    other: formData.get("careerOther"),
  });
  if (!parsed.ok) {
    return {
      status: "error",
      field: parsed.field,
      ...("reason" in parsed ? { reason: parsed.reason } : {}),
    };
  }
  try {
    const { saved } = await saveCareerFromPrompt(userId, {
      roles: parsed.roles,
      other: parsed.other,
    });
    // Con puestos nuevos reasigna las ofertas del pool, igual que Ajustes, pero sin evaluar nada (solo si ya
    // tenía actividad). Si falla, la carrera igual quedó guardada: se loguea y se sigue.
    if (saved && parsed.roles.length > 0) {
      await reassignForRoleChange(userId, { onlyWithActivity: true }).catch((e: unknown) => {
        createLogger({ user_id: userId, task: "career_prompt" }).error(
          { err: safeDbError(e) },
          "no se pudo reasignar el pool tras guardar la carrera",
        );
      });
    }
    // Ya tenía carrera (otra pestaña o claves que el recuadro no pisa): no se vuelve a pedir
    if (!saved) await markCareerPromptAsked(userId);
  } catch (e) {
    createLogger({ user_id: userId, task: "career_prompt" }).error(
      { err: safeDbError(e) },
      "no se pudo guardar la carrera",
    );
    return { status: "error", field: "fallo" };
  }
  revalidatePath("/", "layout");
  return { status: "done" };
}

/** «Ahora no»: no se vuelve a pedir. */
export async function dismissCareerPromptAction(): Promise<void> {
  const userId = await requireActiveUserId();
  try {
    await markCareerPromptAsked(userId);
  } catch (e) {
    createLogger({ user_id: userId, task: "career_prompt" }).error(
      { err: safeDbError(e) },
      "no se pudo anotar que ya se pidió la carrera",
    );
  }
  revalidatePath("/", "layout");
}
