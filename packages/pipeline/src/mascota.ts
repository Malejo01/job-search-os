/**
 * Mascota para lo que no puede importar de `apps/web` (emails y otras piezas puras). El nombre vive
 * en un solo lugar: `apps/web/lib/mascota.ts` lo reexporta/compara con esta constante (un test lo
 * verifica). Nunca se escribe suelto en el código de interfaz.
 */
export const MASCOTA_NOMBRE = "Afi";

/** Pose del email: la que saluda, en PNG (los clientes de correo no leen WebP). */
export const EMAIL_MASCOTA = {
  path: "/mascota/saludando-512.png",
  /** Alto fijo en el email, en px. */
  height: 160,
  /** Ancho que sale de proporcionar el PNG de 512 px de alto a 160 px de alto. */
  width: 94,
} as const;

/**
 * `<img>` de la mascota para un email, con URL absoluta (`appUrl`: origen público, sin barra final),
 * `alt` descriptivo y tamaño fijo. Devuelve "" si `appUrl` no es una URL http(s): sin URL absoluta
 * la imagen no cargaría en el cliente de correo.
 */
export function emailMascotaHtml(appUrl: string, brandName: string): string {
  const base = appUrl.trim().replace(/\/+$/, "");
  if (!/^https?:\/\/[^\s"'<>]+$/.test(base)) return "";
  const alt = `${MASCOTA_NOMBRE}, la mascota de ${brandName}, saluda con la mano`
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
  return `<p style="margin:0 0 16px;"><img src="${base}${EMAIL_MASCOTA.path}" alt="${alt}" width="${EMAIL_MASCOTA.width}" height="${EMAIL_MASCOTA.height}" style="display:block;border:0;width:${EMAIL_MASCOTA.width}px;height:${EMAIL_MASCOTA.height}px;"></p>`;
}
