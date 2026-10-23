/**
 * Cupos de una institución (C-16 §2.2 y §6.1, ticket B2B-2). Puro. Un cupo es una cuenta activa:
 * se consume al canjear la invitación, y las invitaciones pendientes y no vencidas se reservan
 * contra el cupo para que un lote no lo pase.
 */
export type SeatsInput = {
  seats: number;
  active: number;
  pendingNotExpired: number;
  /** Filas nuevas del lote que se quiere crear (las que no son «ya invitada» ni «ya miembro»). */
  requested: number;
};

export type SeatsCheck = { ok: true; left: number } | { ok: false; left: number };

export function checkSeats(input: SeatsInput): SeatsCheck {
  const left = Math.max(0, input.seats - input.active - input.pendingNotExpired);
  return input.requested <= left ? { ok: true, left } : { ok: false, left };
}

/** «Quedan 3 cupos y la planilla trae 8», tal como lo ve el admin de la institución. */
export function seatsMessage(check: SeatsCheck, requested: number): string | null {
  if (check.ok) return null;
  const cupos = check.left === 1 ? "Queda 1 cupo" : `Quedan ${check.left} cupos`;
  return `${cupos} y la planilla trae ${requested}.`;
}
