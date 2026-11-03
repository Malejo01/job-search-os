/**
 * «Ya visto» para los momentos de marca (C9-14): una lista corta en `localStorage`. Todo con
 * try/catch: si el navegador no deja leer o escribir (modo privado, bloqueado), no se anima nada.
 * Devuelve `true` solo la primera vez que se pide una clave que todavía no estaba.
 */
const MAX = 400;

export function firstTimeSeen(storageKey: string, id: string): boolean {
  try {
    const raw = window.localStorage.getItem(storageKey);
    const list: unknown = raw ? JSON.parse(raw) : [];
    const ids = Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : [];
    if (ids.includes(id)) return false;
    ids.push(id);
    window.localStorage.setItem(storageKey, JSON.stringify(ids.slice(-MAX)));
    return true;
  } catch {
    return false;
  }
}

/** Marca como visto sin animar (con «reducir movimiento», para que no se anime después). */
export function markSeen(storageKey: string, id: string): void {
  firstTimeSeen(storageKey, id);
}
