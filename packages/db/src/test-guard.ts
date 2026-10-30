/**
 * Guarda de los tests de integración (JS-121): hacen ALTER ROLE, crean roles e insertan usuarios,
 * así que jamás pueden correr contra una base remota. Se valida el host de la URL antes de conectar.
 * Hosts válidos: loopback (también lo que exponen Testcontainers, que mapea un puerto en localhost)
 * y el servicio de Postgres del CI, que GitHub Actions publica en localhost:5432.
 * No hay variable ni flag para saltearla.
 */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

/**
 * Valida que la URL apunte solo a hosts locales, mirando el host como lo ven WHATWG y postgres.js.
 *
 * WHATWG (`new URL`) toma el host después del ÚLTIMO `@` y corta la autoridad en `/`, `?` o `#`.
 * postgres.js (`parseUrl`, 3.4.x) toma el tramo entre `://` y el primer `/` o `?` (no corta en
 * `#`), se queda con lo que sigue al PRIMER `@`, lo decodifica y, si hay comas, lo usa como lista
 * de hosts. Con `u:p@remoto,@localhost` WHATWG ve `localhost` y postgres.js se conecta primero a
 * `remoto`. Por eso se falla cerrado si ese tramo crudo tiene `,`, `#` o más de un `@` (una
 * contraseña con `@` tiene que ir como `%40`), y además se exige que todos los hosts que calcularía
 * postgres.js sean locales.
 */
export function assertLocalTestDatabase(url: string | undefined): void {
  const raw = url ?? "";
  const parsed = URL.canParse(raw.trim()) ? new URL(raw.trim()) : null;
  // postgres.js ignora el esquema; acá solo se aceptan los de Postgres (WHATWG los pasa a minúscula)
  if (parsed?.protocol !== "postgres:" && parsed?.protocol !== "postgresql:") {
    throw new Error("Guarda de tests: la URL de la base no es válida");
  }
  // new URL entrega el host IPv6 entre corchetes
  const whatwgHost = parsed.hostname;
  const authority = postgresJsAuthority(raw);
  if (/[,#]/.test(authority) || authority.split("@").length > 2) {
    // No se imprime la URL ni el tramo: puede traer credenciales
    throw new Error(
      "Guarda de tests: la URL de la base es ambigua (',', '#' o más de un '@' antes del primer '/'); encodeá la contraseña",
    );
  }
  assertLocalHost(whatwgHost);
  for (const host of postgresJsHosts(authority, whatwgHost)) assertLocalHost(host);
}

/** Tramo crudo que postgres.js trata como autoridad: entre el primer `://` y el primer `/` o `?`. */
function postgresJsAuthority(url: string): string {
  return url.slice(url.indexOf("://") + 3).split(/[?/]/)[0] ?? "";
}

/**
 * Réplica de la lista de hosts de postgres.js (sin puerto): lo que sigue al primer `@`,
 * decodificado; si tiene comas es multihost, si no usa el hostname de WHATWG. A diferencia de
 * postgres.js, respeta los corchetes de IPv6 al sacar el puerto.
 */
function postgresJsHosts(authority: string, whatwgHost: string): string[] {
  let hostPart: string;
  try {
    hostPart = decodeURIComponent(authority.slice(authority.indexOf("@") + 1));
  } catch {
    throw new Error("Guarda de tests: la URL de la base no es válida");
  }
  if (!hostPart.includes(",")) return [whatwgHost];
  return hostPart
    .split(",")
    .map((h) => (h.startsWith("[") ? h.slice(0, h.indexOf("]") + 1) : (h.split(":")[0] ?? "")));
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

/**
 * Valida toda variable de entorno que parezca de base: por forma (valor `postgres://`, con espacios
 * alrededor incluidos) y por nombre (`DATABASE*` con cualquier valor no vacío, `*_URL` con valor
 * que mencione postgres, `PGHOST`/`PGHOSTADDR`).
 */
export function assertLocalTestEnv(env: NodeJS.ProcessEnv = process.env): void {
  // El modo nube se retiró de los tests (ronda 27); si alguien lo vuelve a pedir, se corta acá
  if (env.TEST_DB_TARGET === "cloud") {
    throw new Error("Guarda de tests: el modo nube (TEST_DB_TARGET=cloud) no está permitido");
  }
  for (const [name, value] of Object.entries(env)) {
    if (!value?.trim()) continue;
    const isHost = /^PG(HOST|HOSTADDR)$/i.test(name);
    // DATABASE* se valida siempre, sin mirar el valor: postgres.js conecta igual con pg://, http://…
    const byName = /^DATABASE/i.test(name) || (/_URL$/i.test(name) && /postgres/i.test(value));
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
