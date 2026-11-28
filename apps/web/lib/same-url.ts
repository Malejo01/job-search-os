/**
 * ¿Dos URLs llevan al mismo lugar? Comparación normalizada: sin «www.», sin barra final, sin
 * `#fragmento` y con el protocolo http/https tratado igual; la consulta (`?x=1`) sí cuenta. Ante la
 * duda (alguna no se entiende) devuelve false: quien la usa muestra el enlace, que es un enlace y no
 * una afirmación.
 */
export function sameUrl(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  try {
    const key = (raw: string): string | null => {
      const u = new URL(raw.trim());
      if (u.protocol !== "https:" && u.protocol !== "http:") return null;
      const path = u.pathname.replace(/\/+$/, "");
      return `${u.hostname.toLowerCase().replace(/^www\./, "")}${u.port}${path}${u.search}`;
    };
    const ka = key(a);
    const kb = key(b);
    return ka !== null && ka === kb;
  } catch {
    return false;
  }
}
