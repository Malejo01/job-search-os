/**
 * Documento del iframe donde se muestra HTML externo (emails entrantes, formularios pegados):
 * contenido NO confiable. Puro: no hace I/O. El `sandbox` vacío y la CSP ya cortan scripts y red;
 * esto cierra dos vías de navegación más: `<meta http-equiv="refresh">` (redirige el iframe) y
 * `<base href>` (cambia a dónde apuntan los links relativos).
 */

/**
 * CSP del documento. `form-action` y `base-uri` no heredan de `default-src`: van explícitos.
 * Solo se permiten estilos en línea; ningún pedido de red.
 */
export const EMAIL_FRAME_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; form-action 'none'; base-uri 'none'";

/** Cabecera propia del visor: CSP, viewport y estilos para leer en el ancho del celular. */
const EMAIL_FRAME_HEAD = `<meta http-equiv="Content-Security-Policy" content="${EMAIL_FRAME_CSP}"><meta name="viewport" content="width=device-width, initial-scale=1"><style>
html,body{margin:0;padding:12px;font-family:system-ui,-apple-system,sans-serif;font-size:14px;line-height:1.45;color:#18181b;background:#fff;word-wrap:break-word}
img{max-width:100%;height:auto}table{max-width:100%!important;width:auto}td,th{word-break:break-word}
</style>`;

/** Tamaño máximo del HTML que se procesa; lo que pasa de acá se corta y se muestra como texto. */
export const MAX_EMAIL_HTML = 2_000_000;
const MAX_PASSES = 10;

/**
 * Toda etiqueta `<meta` o `<base`, hasta el primer `>` (o el final). Sobre-borra a propósito:
 * el viewport y la CSP ya los pone `EMAIL_FRAME_HEAD`. Lineal: `[^>]*` no retrocede.
 */
const NAV_TAG = /<(meta|base)(?=[\s/>])[^>]*>?/gi;
const NAV_TAG_LEFT = /<(meta|base)(?=[\s/>])/i;

const escapeLt = (text: string): string => text.replaceAll("<", "&lt;");

/**
 * Saca del HTML todo `<meta` y `<base`. Repite (hasta MAX_PASSES) para que una etiqueta partida
 * por otra (`<me<meta>ta …>`) no reaparezca. Si después del tope todavía queda una, no devuelve
 * HTML: devuelve el texto con todo `<` escapado, que no puede formar ninguna etiqueta.
 */
export function stripNavigationTags(html: string): string {
  if (html.length > MAX_EMAIL_HTML) return escapeLt(html.slice(0, MAX_EMAIL_HTML));
  let current = html;
  for (let i = 0; i < MAX_PASSES; i++) {
    current = current.replace(NAV_TAG, "");
    if (!NAV_TAG_LEFT.test(current)) return current;
  }
  return escapeLt(current);
}

/** Lo que va en el `srcDoc` del iframe: la cabecera propia primero y el HTML externo saneado. */
export function buildEmailFrameDoc(html: string): string {
  return `${EMAIL_FRAME_HEAD}${stripNavigationTags(html)}`;
}
