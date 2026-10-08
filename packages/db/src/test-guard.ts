/**
 * Guarda de los tests de integración (JS-121): hacen ALTER ROLE, crean roles e insertan usuarios,
 * así que jamás pueden correr contra una base remota. Se valida el host de la URL antes de conectar.
 * Hosts válidos: loopback (también lo que exponen Testcontainers, que mapea un puerto en localhost)
 * y el servicio de Postgres del CI, que GitHub Actions publica en localhost:5432.
 * No hay variable ni flag para saltearla.
 */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export function assertLocalTestDatabase(url: string | undefined): void {
  let host: string;
  try {
    // new URL entrega el host IPv6 entre corchetes
    host = new URL((url ?? "").trim()).hostname.replace(/^\[|\]$/g, "").toLowerCase();
  } catch {
    throw new Error("Guarda de tests: la URL de la base no es válida");
  }
  assertLocalHost(host);
}

function assertLocalHost(host: string): void {
  if (
    !LOCAL_HOSTS.has(
      host
        .trim()
        .toLowerCase()
        .replace(/^\[|\]$/g, ""),
    )
  ) {
    // No se imprime la URL: puede traer credenciales
    throw new Error(
      "Guarda de tests: los tests de integración solo corren contra localhost, 127.0.0.1 o ::1",
    );
  }
}

const POSTGRES_URL = /^\s*postgres(ql)?:\/\//i;
/** Variables que se validan por nombre aunque el valor no tenga forma de URL de Postgres. */
const DB_NAME = /^(DATABASE|PGHOST)|_URL$/i;

/**
 * Valida toda variable de entorno que parezca de base: por forma (valor `postgres://`, con espacios
 * alrededor incluidos) y por nombre (`DATABASE*`, `*_URL` con valor que mencione postgres, `PGHOST`).
 */
export function assertLocalTestEnv(env: NodeJS.ProcessEnv = process.env): void {
  // El modo nube apunta a Neon por diseño y carga sus URL dentro del test, después de esta guarda
  if (env.TEST_DB_TARGET === "cloud") {
    throw new Error("Guarda de tests: el modo nube (TEST_DB_TARGET=cloud) no está permitido");
  }
  for (const [name, value] of Object.entries(env)) {
    if (!value?.trim()) continue;
    const isHost = /^PG(HOST|HOSTADDR)$/i.test(name);
    const byName = DB_NAME.test(name) && (isHost || /postgres/i.test(value));
    if (isHost || byName || POSTGRES_URL.test(value)) {
      try {
        if (isHost) assertLocalHost(value);
        else assertLocalTestDatabase(value);
      } catch (e) {
        throw new Error(`${(e as Error).message} (variable ${name})`, { cause: e });
      }
    }
  }
}
