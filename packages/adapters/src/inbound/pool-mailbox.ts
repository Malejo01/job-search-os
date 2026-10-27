import { ROLE_KEYS } from "@job-search-os/pipeline";

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
};

/** Remitente de la fuente de alertas del pool (ADR-024 §1): solo ese portal. */
export const POOL_ALERT_SENDER_DOMAINS: readonly string[] = ["computrabajo.com"];

/** Valor de `inbound_emails.parser` para los emails del pool que esperan lector (ADR-024 §9). */
export const POOL_PARSER = "pool_computrabajo_alerts";

export const POOL_MANUAL_QUEUE_REASON =
  "casilla del pool sin lector validado: cola manual (nunca extracción parcial)";

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
  };
}

/** ¿El remitente es uno de los dominios o un subdominio? Las variantes por país se listan aparte. */
export function isPoolAlertSender(from: string, domains: readonly string[]): boolean {
  const addr = (/<([^>]+)>/.exec(from)?.[1] ?? from).trim().toLowerCase();
  if (addr.split("@").length !== 2) return false;
  const domain = addr.split("@")[1]!;
  return domains.some((d) => {
    const base = d.toLowerCase();
    return domain === base || domain.endsWith(`.${base}`);
  });
}
