import { festejoClave, type Festejo } from "@/lib/momentos";

/**
 * Festejos que se disparan al llegar a otra pantalla (R27-04: el CV terminado con el coach). Quien termina
 * el logro deja una marca en `sessionStorage` justo antes de navegar y la pantalla de destino la consume:
 * así el festejo sale una sola vez por evento y recargar la página no lo repite. Sin almacenamiento
 * (modo privado), no hay festejo: mejor no festejar que festejar siempre.
 */
export function marcarFestejoPendiente(festejo: Festejo): void {
  try {
    window.sessionStorage.setItem(festejoClave(festejo), "1");
  } catch {
    // Sin almacenamiento: no se festeja
  }
}

/** Devuelve `true` una sola vez por marca y la borra. */
export function consumirFestejoPendiente(festejo: Festejo): boolean {
  try {
    const key = festejoClave(festejo);
    if (window.sessionStorage.getItem(key) !== "1") return false;
    window.sessionStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}
