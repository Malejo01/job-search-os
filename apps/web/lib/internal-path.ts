/**
 * ¿Es una ruta de esta misma app? Rechaza `//host` y `/\host`, que el navegador lee como otro sitio, y
 * los caracteres de control, porque el navegador los quita antes de resolver la dirección.
 */
export function isInternalPath(path: unknown): path is string {
  if (typeof path !== "string" || !/^\/(?![/\\])/.test(path)) return false;
  for (let i = 0; i < path.length; i++) {
    const code = path.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return false;
  }
  return true;
}
