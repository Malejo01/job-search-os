/**
 * Lectura de variables de configuración (modos y plazos) sin I/O: reciben el valor crudo y devuelven el
 * valor y, si el valor no se entiende, un mensaje de error para que el adapter lo registre. Ante un valor
 * desconocido nunca se adivina: rige el valor por defecto (la protección que el modo apagaría queda como
 * estaba) y el error avisa. El valor mal escrito no se copia al mensaje.
 */
export type ConfigRead<T> = { value: T; error: string | null };

/** Modo de una variable: recorta espacios, ignora mayúsculas y acepta solo los valores conocidos. */
export function readMode<T extends string>(
  name: string,
  raw: string | undefined,
  allowed: readonly T[],
  fallback: T,
): ConfigRead<T> {
  const text = raw?.trim().toLowerCase();
  if (!text) return { value: fallback, error: null };
  const known = allowed.find((mode) => mode === text);
  if (known) return { value: known, error: null };
  return {
    value: fallback,
    error: `${name} tiene un valor desconocido (valores válidos: ${allowed.join(", ")}): rige «${fallback}»`,
  };
}

/**
 * Avisos de configuración del correo entrante para `/settings/salud`: se calculan solo con las variables
 * (sin consultar la base) y nunca copian el valor mal escrito. Lista vacía = nada que avisar. Los valores
 * válidos de los modos son los mismos que usa el handler (`INBOUND_SIZE_MODE`: log o enforce;
 * `INBOUND_DMARC_MODE`: off, log o enforce).
 */
export function inboundConfigWarnings(env: Record<string, string | undefined>): string[] {
  const warnings: string[] = [];
  const size = readMode("INBOUND_SIZE_MODE", env.INBOUND_SIZE_MODE, ["log", "enforce"], "log");
  if (size.error) warnings.push(size.error);
  const dmarc = readMode(
    "INBOUND_DMARC_MODE",
    env.INBOUND_DMARC_MODE,
    ["off", "log", "enforce"],
    "log",
  );
  if (dmarc.error) warnings.push(dmarc.error);
  if (dmarc.value === "enforce" && !env.INBOUND_AUTHSERV_ID?.trim()) {
    warnings.push(
      "INBOUND_DMARC_MODE está en «enforce» pero falta INBOUND_AUTHSERV_ID: ningún email queda verificado y todos los de portales se retienen",
    );
  }
  const retention = readIntegerSetting(
    "INBOUND_RAW_RETENTION_DAYS",
    env.INBOUND_RAW_RETENTION_DAYS,
    1,
    3650,
  );
  if (retention.error) warnings.push(retention.error);
  const maxBytes = readIntegerSetting(
    "INBOUND_MAX_BYTES_PER_USER",
    env.INBOUND_MAX_BYTES_PER_USER,
    1_000_000,
    100 * 1024 * 1024 * 1024,
  );
  if (maxBytes.error) warnings.push(maxBytes.error);
  return warnings;
}

/** Entero entre `min` y `max`. Ausente o vacío no es un error: `null`. Cualquier otra cosa es un error. */
export function readIntegerSetting(
  name: string,
  raw: string | undefined,
  min: number,
  max: number,
): ConfigRead<number | null> {
  const text = raw?.trim();
  if (!text) return { value: null, error: null };
  const n = /^\d+$/.test(text) ? Number(text) : NaN;
  if (Number.isInteger(n) && n >= min && n <= max) return { value: n, error: null };
  return {
    value: null,
    error: `${name} no es un entero de ${min} a ${max}: la función queda apagada`,
  };
}
