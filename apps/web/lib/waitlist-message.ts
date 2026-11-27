import { careerAccess, type RoleKey } from "@job-search-os/pipeline";
import { ALTA_TEXTOS, llenarTexto } from "./textos-rediseno";

/**
 * Lo que ve quien se anota en la lista de espera pública (R32-03). Puro: recibe la carrera que eligió, la lista de
 * carreras abiertas (o `null` si no se pudo leer) y cómo se nombra una carrera (`labelOf`, el catálogo de la web), y
 * devuelve el texto de confirmación.
 *
 * - Carrera abierta, o sin dato de la lista: el mensaje de siempre (`base`). Sin dato nunca se asume «cerrada»: la
 *   persona queda anotada igual y el aviso de espera podría ser falso.
 * - Carrera que todavía no abrió: «Todavía estamos sumando ofertas de {carrera}. Te avisamos por email apenas abra».
 *
 * El mensaje depende solo de la carrera, no de si el email ya estaba anotado: así no se puede averiguar quién está.
 */
export function waitlistDoneMessage(
  role: string,
  openCareers: readonly string[] | null,
  base: string,
  labelOf: (career: RoleKey) => string,
): string {
  if (openCareers === null) return base;
  const decision = careerAccess({ career: role, openCareers, existingAccount: false });
  if (decision.access !== "lista_de_espera" || decision.career === null) return base;
  return `Listo, te anotamos. ${llenarTexto(ALTA_TEXTOS.esperaCarrera, {
    carrera: labelOf(decision.career),
  })}`;
}
