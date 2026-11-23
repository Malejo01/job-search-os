/** Clave del aviso de bienvenida del asistente: una sola vez por sesión del navegador. */
export const ASISTENTE_AVISO_KEY = "afinia:asistente-aviso-sesion";

type Almacen = Pick<Storage, "getItem" | "setItem">;

/**
 * Decide si hay que mostrar el aviso «Preguntame lo que quieras» y, si sí, lo deja marcado.
 * Pura salvo por el almacén que recibe (sessionStorage en el navegador). Si no hay almacén o falla
 * leer o escribir, no se muestra: preferimos no avisar a repetir el aviso en cada página.
 */
export function claimAsistenteAviso(storage: Almacen | null): boolean {
  if (!storage) return false;
  try {
    if (storage.getItem(ASISTENTE_AVISO_KEY) === "1") return false;
    storage.setItem(ASISTENTE_AVISO_KEY, "1");
    return true;
  } catch {
    return false;
  }
}
