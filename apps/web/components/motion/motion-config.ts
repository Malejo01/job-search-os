/**
 * Parámetros puros de las microinteracciones (R23-06), para poder probarlos sin DOM. Regla común:
 * con «reducir movimiento», o antes de la primera apertura, no hay estado inicial animado
 * (`initial: false` = se dibuja directo en el estado final) y la duración es 0.
 */
export function disclosureMotion(input: { reduce: boolean; openCount: number }) {
  const animated = !input.reduce && input.openCount > 0;
  return {
    initial: animated ? { height: 0, opacity: 0 } : (false as const),
    animate: { height: "auto", opacity: 1 },
    transition: { duration: input.reduce ? 0 : 0.22 },
  };
}

export function barMotion(input: {
  reduce: boolean;
  openCount: number;
  percent: number;
  index: number;
}) {
  const animated = !input.reduce && input.openCount > 0;
  return {
    initial: animated ? { width: "0%" } : (false as const),
    animate: { width: `${input.percent}%` },
    transition: {
      duration: input.reduce ? 0 : 0.5,
      // Escalonadas, con tope para que no se sienta lento
      delay: input.reduce ? 0 : Math.min(0.08 * input.index + 0.1, 0.4),
    },
  };
}
