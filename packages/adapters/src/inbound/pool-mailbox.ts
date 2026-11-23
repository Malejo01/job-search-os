import { parseFromAddress, ROLE_KEYS } from "@job-search-os/pipeline";

/**
 * Casillas `pool-<carrera>@` del inbound (ADR-024). El interruptor y el dominio de ingesta se leen
 * en el borde, una vez por email, y el resto trabaja con el dato ya resuelto.
 */
export type PoolInboundConfig = {
  enabled: boolean;
  ingestDomain: string;
  /** Dominios (base) que valen como remitente de la fuente. */
  senderDomains: readonly string[];
  careers: readonly string[];
  /**
   * Lector de las alertas de Computrabajo (R19-01, ADR-043). Apagado (o ausente): todo email del pool va a
   * la cola manual, como antes. Solo tiene efecto con `enabled`.
   */
  computrabajoReader?: boolean;
};

/** Remitente de la fuente de alertas del pool (ADR-024 §1): solo ese portal. */
export const POOL_ALERT_SENDER_DOMAINS: readonly string[] = ["computrabajo.com"];

/** Valor de `inbound_emails.parser` para los emails del pool que esperan lector (ADR-024 §9). */
export const POOL_PARSER = "pool_computrabajo_alerts";

export const POOL_MANUAL_QUEUE_REASON =
  "casilla del pool sin lector validado: cola manual (nunca extracción parcial)";

/** Con el lector prendido, un email que no se pudo leer queda en la cola con el motivo (sin texto del email). */
export const POOL_READER_FAILED_PREFIX = "casilla del pool: estructura no reconocida";

export const POOL_OVERSIZE_REASON =
  "casilla del pool: el email pasa el tope de tamaño, se guardó solo remitente, asunto y fecha, sin el cuerpo";

/** Topes de la cola del pool (filas con user_id NULL y este parser): por hora y por 24 h. */
export const POOL_QUEUE_MAX_PER_HOUR = 30;
export const POOL_QUEUE_MAX_PER_DAY = 200;
/** Tamaño máximo del crudo completo que se guarda. */
export const POOL_RAW_MAX_BYTES = 256 * 1024;

/** Cualquier valor distinto de "1" es apagado. */
export function readPoolInboundConfig(
  env: Record<string, string | undefined> = process.env,
): PoolInboundConfig {
  return {
    enabled: env.POOL_SOURCE_COMPUTRABAJO_ALERTS === "1",
    ingestDomain: (env.INGEST_DOMAIN ?? "").trim().toLowerCase(),
    senderDomains: POOL_ALERT_SENDER_DOMAINS,
    careers: ROLE_KEYS,
    computrabajoReader: env.POOL_COMPUTRABAJO_READER === "1",
  };
}

/** ¿El remitente es uno de los dominios o un subdominio? Las variantes por país se listan aparte. */
export function isPoolAlertSender(from: string, domains: readonly string[]): boolean {
  const addr = parseFromAddress(from);
  if (!addr) return false;
  const domain = addr.slice(addr.lastIndexOf("@") + 1);
  return domains.some((d) => {
    const base = d.toLowerCase();
    return domain === base || domain.endsWith(`.${base}`);
  });
}
