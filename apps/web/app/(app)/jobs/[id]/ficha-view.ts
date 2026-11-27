/**
 * Vista de la ficha del aviso (R31-04). Puro: recibe la ficha ya verificada por el código
 * (`verifyJobCard`) y devuelve lo que la pantalla muestra. No decide nada ni deduce: lo que la
 * ficha no trae queda vacío y la pantalla dice «No especificado».
 *
 * Los tipos son estructurales y `JobCard` (`packages/pipeline/src/job-card/schema.ts`) los cumple: se
 * le pasa la ficha tal cual. Se cambian por el import cuando el índice del paquete la exporte.
 */

export type FichaNivel = "indispensable" | "deseable" | "sin_distinguir";

export type FichaDato = { texto: string; cita: string };
export type FichaRequisito = FichaDato & { nivel: FichaNivel };

export type FichaParaVista = {
  /** Como `JobCard["resumen"]`: el resumen se apoya en varias citas. */
  resumen: { texto: string; citas: readonly string[] } | null;
  tareas: readonly FichaDato[];
  requisitos: readonly FichaRequisito[];
};

export type FichaEstado = "lista" | "preparando" | "fallida" | "sin_texto" | "tope" | "apagada";

export type QueBuscanView = {
  /** El aviso separa indispensable de deseable (hay al menos uno de cada grupo con nivel claro). */
  distingue: boolean;
  indispensables: FichaRequisito[];
  deseables: FichaRequisito[];
  /** Solo se llena cuando el aviso no distingue. */
  todos: FichaRequisito[];
};

export type FichaView = {
  resumen: FichaDato | null;
  tareas: FichaDato[];
  buscan: QueBuscanView;
};

const clean = (s: string) => s.trim();

function limpiar<T extends FichaDato>(list: readonly T[]): T[] {
  // Falla cerrado: sin texto no hay dato; una cita vacía no se muestra pero el dato sí
  return list.filter((d) => clean(d.texto) !== "").map((d) => ({ ...d, texto: clean(d.texto) }));
}

/** «Qué buscan»: indispensable y deseable solo si el aviso los distingue (plan §6). */
export function queBuscanView(requisitos: readonly FichaRequisito[]): QueBuscanView {
  const todos = limpiar(requisitos);
  const indispensables = todos.filter((r) => r.nivel === "indispensable");
  const deseables = todos.filter((r) => r.nivel === "deseable");
  const distingue = todos.length > 0 && todos.every((r) => r.nivel !== "sin_distinguir");
  return distingue
    ? { distingue: true, indispensables, deseables, todos: [] }
    : { distingue: false, indispensables: [], deseables: [], todos };
}

export function fichaView(card: FichaParaVista): FichaView {
  const resumen =
    card.resumen && clean(card.resumen.texto)
      ? {
          texto: clean(card.resumen.texto),
          cita: card.resumen.citas.map(clean).filter(Boolean).join("\n"),
        }
      : null;
  return {
    resumen,
    tareas: limpiar(card.tareas),
    buscan: queBuscanView(card.requisitos),
  };
}

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}+#.]+/gu, " ")
    .trim();

/**
 * R31-07: «Habilidades» solo con las ligadas al puesto según la ficha. Una fila de la tabla (que
 * nombra una habilidad del aviso) se queda si la ficha trae una habilidad con el mismo nombre
 * (sin mayúsculas ni tildes; uno contiene al otro). Con `ficha = null` (apagada o sin ficha) no
 * se filtra nada: queda lo que la R30 mostraba. Con ficha pero sin habilidades, queda vacío.
 */
export function habilidadesDelPuesto<T extends { pide: string }>(
  filas: readonly T[],
  ficha: readonly { nombre: string }[] | null,
): T[] {
  if (ficha === null) return [...filas];
  const nombres = ficha.map((h) => fold(h.nombre)).filter(Boolean);
  return filas.filter((f) => {
    const n = fold(f.pide.replace(/^Menciona\s+/i, ""));
    return n !== "" && nombres.some((h) => h === n || h.includes(n) || n.includes(h));
  });
}

/** ¿Hay algo para mostrar en cada bloque? Sin ficha lista, no se muestra nada. */
export function fichaTieneContenido(view: FichaView): boolean {
  return (
    view.resumen !== null ||
    view.tareas.length > 0 ||
    view.buscan.todos.length > 0 ||
    view.buscan.indispensables.length > 0 ||
    view.buscan.deseables.length > 0
  );
}
