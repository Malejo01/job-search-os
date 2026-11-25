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
  width: 114,
  /** Lavanda de respaldo detrás de la mascota (el círculo de la app) y color del texto alternativo. */
  fondo: "#EEEDF9",
  fondoTexto: "#1E1B4B",
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
  const w = EMAIL_MASCOTA.width;
  const h = EMAIL_MASCOTA.height;
  // R28-11: la imagen es un sticker transparente. Va sobre una celda con fondo propio (`bgcolor` y estilo, para
  // Outlook y Gmail) así no depende del blanco de la tarjeta: si un cliente oscurece el email, la mascota sigue
  // sobre su lavanda. `border="0"` y el estilo de `alt` (letra y color) cubren al cliente que bloquea imágenes.
  const img = `<img src="${base}${EMAIL_MASCOTA.path}" alt="${alt}" width="${w}" height="${h}" border="0" style="display:block;border:0;outline:none;text-decoration:none;width:${w}px;height:${h}px;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.3;color:${EMAIL_MASCOTA.fondoTexto};">`;
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px;"><tr><td align="center" bgcolor="${EMAIL_MASCOTA.fondo}" style="background-color:${EMAIL_MASCOTA.fondo};border-radius:20px;padding:12px 20px;">${img}</td></tr></table>`;
}
