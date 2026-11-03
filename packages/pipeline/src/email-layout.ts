import { BRAND, BRAND_COLORS } from "./brand";

/**
 * Encabezado y pie de marca para los emails transaccionales (C7-2): recuperación de contraseña,
 * aviso de vencimiento del plan y soporte. HTML simple con tablas y estilos en línea, como lo leen
 * los clientes de email. Sin imágenes ni fuentes remotas: el logotipo es texto con los colores de
 * marca (Sora si el cliente la tiene, si no la sans del sistema).
 */
export function escapeEmailHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const FONT = "Manrope, 'Segoe UI', Helvetica, Arial, sans-serif";
const LOGO_FONT = "Sora, 'Segoe UI', Helvetica, Arial, sans-serif";

/** Estilo de un link dentro del cuerpo: índigo vivo (7,9:1 sobre blanco). */
export const EMAIL_LINK_STYLE = `color:${BRAND_COLORS.accentDeep};text-decoration:underline;`;

export function brandedEmailHtml({
  bodyHtml,
  preheader,
}: {
  /** Cuerpo ya armado y escapado por quien llama. */
  bodyHtml: string;
  /** Línea que algunos clientes muestran junto al asunto. Texto plano: se escapa acá. */
  preheader?: string;
}): string {
  const pre = preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeEmailHtml(preheader)}</div>`
    : "";
  return [
    `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"></head>`,
    `<body style="margin:0;padding:0;background:${BRAND_COLORS.canvas};">`,
    pre,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND_COLORS.canvas};"><tr><td align="center" style="padding:24px 12px;">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">`,
    // Encabezado: logotipo AfinIA (800, lima) + Jobs (300, blanco) sobre índigo
    `<tr><td style="background:${BRAND_COLORS.ink};border-radius:16px 16px 0 0;padding:20px 24px;font-family:${LOGO_FONT};font-size:26px;line-height:1;letter-spacing:-1px;">`,
    `<span style="font-weight:800;color:${BRAND_COLORS.accent};">${escapeEmailHtml(BRAND.wordmark.strong)}</span>`,
    `<span style="font-weight:300;color:${BRAND_COLORS.white};">${escapeEmailHtml(BRAND.wordmark.light)}</span>`,
    `</td></tr>`,
    `<tr><td style="background:${BRAND_COLORS.white};border-radius:0 0 16px 16px;padding:24px;font-family:${FONT};font-size:15px;line-height:1.5;color:${BRAND_COLORS.ink};">`,
    bodyHtml,
    `</td></tr>`,
    `<tr><td style="padding:16px 8px;font-family:${FONT};font-size:12px;line-height:1.5;color:${BRAND_COLORS.textMuted};text-align:center;">`,
    `${escapeEmailHtml(BRAND.name)} · ${escapeEmailHtml(BRAND.tagline)}`,
    `</td></tr>`,
    `</table></td></tr></table></body></html>`,
  ].join("");
}

const URL_RE = /https?:\/\/[^\s<>"']+/g;

/**
 * Texto simple → párrafos HTML. Escapa todo, convierte las URLs http(s) en links y deja los saltos
 * de línea. Para mandar el mismo contenido en `text` y en `html` sin escribirlo dos veces.
 */
export function textToEmailHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((block) => {
      const lines = block.split("\n").map((line) => {
        let out = "";
        let last = 0;
        for (const m of line.matchAll(URL_RE)) {
          const url = m[0];
          out += escapeEmailHtml(line.slice(last, m.index));
          out += `<a href="${escapeEmailHtml(url)}" style="${EMAIL_LINK_STYLE}">${escapeEmailHtml(url)}</a>`;
          last = (m.index ?? 0) + url.length;
        }
        return out + escapeEmailHtml(line.slice(last));
      });
      return `<p style="margin:0 0 12px;">${lines.join("<br>")}</p>`;
    })
    .join("");
}
