import { PRODUCT_NAME, brandedEmailHtml } from "@job-search-os/pipeline";

/**
 * Aviso a los admins de un informe nuevo (R29-03). Lleva SOLO el resumen («12 ítems, 18 capturas, 2 documentos») y
 * el link a `/admin/informes`: ni el texto de la persona, ni su nombre, ni su email (el admin lo lee adentro, con
 * sesión). Puro: `buildReportEmail` arma el mensaje; `notifyReportAdmins` recibe el envío por parámetro, así en
 * los tests y en local (sin `RESEND_API_KEY`) corre un envío simulado que solo registra y no sale nada.
 */

export type ReportEmail = { subject: string; html: string; text: string };

/** La URL pública de la app, sin barra final; `null` si no está configurada (el aviso dice la ruta sin link). */
export function siteBaseUrl(env: Record<string, string | undefined>): string | null {
  const raw = env.SITE_URL || env.AUTH_URL || env.NEXT_PUBLIC_APP_URL;
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

const escapeHtml = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

export function buildReportEmail(input: { summary: string; baseUrl: string | null }): ReportEmail {
  const path = "/admin/informes";
  const link = input.baseUrl ? `${input.baseUrl}${path}` : null;
  const lead = `Llegó un informe de revisión nuevo: ${input.summary}.`;
  const where = link ? `Leelo acá: ${link}` : `Leelo en ${path} (con tu sesión de admin).`;
  const html = brandedEmailHtml({
    preheader: lead,
    bodyHtml: `
    <h2 style="margin:0 0 12px;">Nuevo informe de revisión</h2>
    <p>${escapeHtml(lead)}</p>
    <p>${
      link
        ? `<a href="${escapeHtml(link)}">Abrir el informe en la app</a>`
        : `Leelo en <code>${path}</code> con tu sesión de admin.`
    }</p>
  `,
  });
  return {
    subject: `[Informe] Nuevo informe de revisión — ${PRODUCT_NAME}`,
    html,
    text: `${lead}\n${where}\n`,
  };
}

export type ReportEmailSender = (message: ReportEmail & { to: string }) => Promise<void>;

/**
 * Manda el aviso a cada admin con el envío recibido. Un fallo con uno no frena a los demás ni rompe el envío del
 * informe: se cuenta y se devuelve. `admins` sale de `ADMIN_EMAILS`.
 */
export async function notifyReportAdmins(deps: {
  summary: string;
  baseUrl: string | null;
  admins: readonly string[];
  send: ReportEmailSender;
}): Promise<{ sent: number; failed: number }> {
  const email = buildReportEmail({ summary: deps.summary, baseUrl: deps.baseUrl });
  let sent = 0;
  let failed = 0;
  for (const to of deps.admins) {
    try {
      await deps.send({ ...email, to });
      sent++;
    } catch {
      failed++;
    }
  }
  return { sent, failed };
}

/** Los emails de `ADMIN_EMAILS`, en minúsculas y sin repetir. */
export function adminEmailsFrom(env: Record<string, string | undefined>): string[] {
  return [
    ...new Set(
      (env.ADMIN_EMAILS ?? "")
        .split(",")
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
}
