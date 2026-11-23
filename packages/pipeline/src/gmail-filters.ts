/**
 * Archivo de filtros para «Importar filtros» de Gmail: reenvía las alertas de empleo a la dirección
 * del usuario y las saca de Recibidos. Puro: la fecha la pasa quien llama. No incluye
 * `shouldMarkAsRead` ni aplicar a conversaciones existentes (el XML no lo exporta).
 */
import { PRODUCT_NAME } from "./product";

/** Remitentes de alertas de empleo. Los dominios solos los acepta el criterio `from` de Gmail. */
export const DEFAULT_ALERT_SENDERS: readonly string[] = [
  "jobalerts-noreply@linkedin.com",
  "jobs-noreply@linkedin.com",
  "getonbrd.com",
  "getonboard.com",
  "indeed.com",
  "bumeran.com",
  // ZonaJobs todavía no tiene lector: sus mails llegan a la cola manual con el cuerpo guardado.
  "zonajobs.com.ar",
];

const ADDRESS_RE = /^u_([a-z2-7]{20})@[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/;

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Único remitente que reenvía el filtro del pool (ADR-024 §1): las alertas de Computrabajo. */
export const POOL_FILTER_SENDER = "computrabajo.com";

const INGEST_DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
const CAREER_RE = /^[a-z0-9_]+$/;

/**
 * Filtro de Gmail de UNA carrera para las casillas del pool: `from:computrabajo.com` → reenviar a
 * `pool-<carrera>@<dominio de ingesta>`. Un archivo por carrera: Computrabajo manda todas las alertas desde
 * el mismo remitente, así que dos filtros en la misma cuenta reenviarían cada email a las dos casillas.
 * Nunca hay un filtro sin criterio `from` (no reenvía todo). Falla cerrado con dominio o carrera inválidos.
 */
export function poolGmailFilterXml(input: {
  ingestDomain: string;
  career: string;
  careers: readonly string[];
  now: Date;
}): string {
  const domain = input.ingestDomain.trim().toLowerCase();
  if (!INGEST_DOMAIN_RE.test(domain)) throw new Error("dominio de ingesta inválido");
  if (!CAREER_RE.test(input.career) || !input.careers.includes(input.career)) {
    throw new Error("carrera desconocida");
  }
  const forwardTo = `pool-${input.career}@${domain}`;
  return [
    "<?xml version='1.0' encoding='UTF-8'?>",
    '<feed xmlns="http://www.w3.org/2005/Atom" xmlns:apps="http://schemas.google.com/apps/2006">',
    `  <title>Filtro de ${escapeXml(PRODUCT_NAME)}: alertas de Computrabajo</title>`,
    `  <updated>${input.now.toISOString()}</updated>`,
    "  <entry>",
    "    <category term='filter'/>",
    `    <title>Alertas de Computrabajo hacia ${escapeXml(PRODUCT_NAME)}</title>`,
    `    <updated>${input.now.toISOString()}</updated>`,
    `    <apps:property name='from' value='${escapeXml(POOL_FILTER_SENDER)}'/>`,
    `    <apps:property name='forwardTo' value='${escapeXml(forwardTo)}'/>`,
    "  </entry>",
    "</feed>",
    "",
  ].join("\n");
}

export function gmailFiltersXml(input: {
  forwardTo: string;
  senders: readonly string[];
  now: Date;
}): string {
  const match = ADDRESS_RE.exec(input.forwardTo);
  if (!match) {
    throw new Error("dirección de reenvío inválida");
  }
  if (input.senders.length === 0) throw new Error("faltan remitentes");
  const from = input.senders.map(escapeXml).join(" OR ");
  return [
    "<?xml version='1.0' encoding='UTF-8'?>",
    '<feed xmlns="http://www.w3.org/2005/Atom" xmlns:apps="http://schemas.google.com/apps/2006">',
    `  <title>Filtros de ${escapeXml(PRODUCT_NAME)}</title>`,
    `  <updated>${input.now.toISOString()}</updated>`,
    "  <entry>",
    "    <category term='filter'/>",
    `    <title>Alertas de empleo hacia ${escapeXml(PRODUCT_NAME)}</title>`,
    `    <updated>${input.now.toISOString()}</updated>`,
    `    <apps:property name='from' value='${from}'/>`,
    `    <apps:property name='forwardTo' value='${escapeXml(input.forwardTo)}'/>`,
    "    <apps:property name='shouldArchive' value='true'/>",
    "  </entry>",
    "</feed>",
    "",
  ].join("\n");
}
