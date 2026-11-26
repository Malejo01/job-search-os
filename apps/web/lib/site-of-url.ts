/**
 * Nombre del sitio de un aviso para «Ir a postularme en {sitio}»: el dominio sin «www.». Solo http(s);
 * lo que no se entiende devuelve null y el botón dice «Ir a postularme» a secas (falla cerrado).
 */
export function siteOfUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    const host = u.hostname.replace(/^www\./i, "").toLowerCase();
    return host.length > 0 && host.length <= 60 ? host : null;
  } catch {
    return null;
  }
}
