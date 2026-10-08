/**
 * Paso actual del asistente de reenvío de Gmail (ronda 26). Función pura: los hechos los junta
 * `apps/web/lib/assistant-state.ts` desde la base y el resultado solo decide qué mostrar.
 */
export type AssistantFacts = {
  /** La dirección es de un formato anterior: hay que rotarla antes de configurar Gmail. */
  legacyAddress: boolean;
  /** Llegó el pedido de confirmación de Gmail y sigue sin marcarse como visto. */
  gmailConfirmationPending: boolean;
  /** Hubo un pedido de confirmación que la persona ya marcó como visto. */
  gmailConfirmationSeen: boolean;
  /** La persona dijo «Ya importé los filtros». */
  filtersAcknowledged: boolean;
  /** Llegó al menos un email del que se extrajo un aviso. */
  firstAlertReceived: boolean;
};

export type AssistantStep =
  | "direccion_vieja"
  | "agregar_direccion"
  | "confirmar_reenvio"
  | "importar_filtros"
  | "esperando_alerta"
  | "listo";

/** Los cinco pasos que se muestran en la lista, en orden. */
export const ASSISTANT_STEPS = [
  "agregar_direccion",
  "confirmar_reenvio",
  "importar_filtros",
  "esperando_alerta",
  "listo",
] as const satisfies readonly AssistantStep[];

/**
 * Prioridad: direccion_vieja > listo > confirmar_reenvio > importar_filtros > esperando_alerta >
 * agregar_direccion. Un pedido de Gmail nuevo sin ver vuelve al paso 2 aunque ya se hayan
 * importado los filtros (hay un reenvío por confirmar), salvo que ya haya llegado una alerta.
 */
export function assistantStep(f: AssistantFacts): AssistantStep {
  if (f.legacyAddress) return "direccion_vieja";
  if (f.firstAlertReceived) return "listo";
  if (f.gmailConfirmationPending) return "confirmar_reenvio";
  if (f.gmailConfirmationSeen && !f.filtersAcknowledged) return "importar_filtros";
  if (f.filtersAcknowledged) return "esperando_alerta";
  return "agregar_direccion";
}
