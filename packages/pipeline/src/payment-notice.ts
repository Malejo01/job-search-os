/**
 * «Ya pagué»: avisos de pago que carga la persona para que el equipo los confirme a mano. Puro: valida el
 * número de operación y decide si se puede crear un aviso más. La app no se conecta a Mercado Pago ni
 * guarda datos de pago: el número de operación (opcional, solo dígitos) es el único dato además del plan
 * pedido, el estado y las fechas. El modelo no interviene: ningún texto libre llega a esta decisión.
 */
import { err, ok, type Result } from "./result";

export const PAYMENT_NOTICE_STATUSES = ["pendiente", "activado", "rechazado"] as const;
export type PaymentNoticeStatus = (typeof PAYMENT_NOTICE_STATUSES)[number];

/** Avisos pendientes que puede tener una persona a la vez. El cuarto no se crea. */
export const MAX_OPEN_PAYMENT_NOTICES = 3;

/** Largo máximo del número de operación (los de Mercado Pago tienen entre 10 y 12 dígitos). */
export const OPERATION_NUMBER_MAX_LENGTH = 20;

export const PAYMENT_NOTICE_MESSAGES = {
  recibido: "Recibimos tu aviso: lo confirmamos a mano en menos de 24 h.",
  pendiente:
    "Tenés un aviso de pago pendiente: lo confirmamos a mano en menos de 24 h. No hace falta que lo mandes de nuevo.",
  tope: "Ya tenés 3 avisos pendientes. Esperá a que los confirmemos o escribinos si algo no cuadra.",
  invalido: "El número de operación tiene que ser solo dígitos, hasta 20. Podés dejarlo vacío.",
  error: "No pudimos guardar tu aviso. Probá de nuevo en un rato o escribinos.",
} as const;

/** Vacío o ausente vale (sin número); si hay texto, solo dígitos y hasta el largo máximo. */
export function parseOperationNumber(raw: unknown): Result<string | null, "invalido"> {
  if (raw === null || raw === undefined) return ok(null);
  if (typeof raw !== "string") return err("invalido");
  const value = raw.trim();
  if (value === "") return ok(null);
  if (value.length > OPERATION_NUMBER_MAX_LENGTH || !/^[0-9]+$/.test(value)) return err("invalido");
  return ok(value);
}

/** ¿Se puede crear otro aviso con `openCount` pendientes? Un conteo que no es válido falla cerrado. */
export function decidePaymentNotice(openCount: number): Result<"crear", "tope"> {
  if (!Number.isInteger(openCount) || openCount < 0) return err("tope");
  return openCount >= MAX_OPEN_PAYMENT_NOTICES ? err("tope") : ok("crear");
}
