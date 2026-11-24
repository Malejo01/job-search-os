import { canReviewAcademy } from "./academy-access";

/**
 * ¿Esta persona ve `/recorrido` (R26-03)? Las mismas que revisan Academy: admins (`ADMIN_EMAILS`) y testers
 * (`ASSISTANT_TESTER_EMAILS` o el rol tester de la base). Se decide en el servidor con la sesión y falla
 * cerrado. No lee las listas directamente: delega en `canReviewAcademy`, así hay un solo lugar donde
 * se define quién revisa.
 */
export async function canViewRecorrido(userId: string): Promise<boolean> {
  return canReviewAcademy(userId);
}
