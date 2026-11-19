import { createHash, createHmac } from "node:crypto";

/** Hash scrypt válido que ninguna contraseña verifica (sal y hash en cero): solo iguala el costo del login. */
const DUMMY_PASSWORD_HASH = `scrypt$${"0".repeat(32)}$${"0".repeat(128)}`;

export type LoginDeps = {
  /**
   * Reserva un intento para ese email desde esa IP (`ipHash` nulo: no se conoce la IP). `false`: está en espera
   * y no se verifica nada.
   */
  beginAttempt(emailHash: string, ipHash: string | null): Promise<boolean>;
  clearAttempts(emailHash: string): Promise<void>;
  findUser(email: string): Promise<{ id: string; password_hash: string | null } | undefined>;
  verifyPassword(password: string, stored: string): Promise<boolean>;
  /** Espera lo que tarda una verificación: un intento en espera responde en un tiempo parecido. */
  waitLikeVerification(): Promise<void>;
  sessionVersion(userId: string): Promise<number>;
};

export type LoginUser = { id: string; email: string; sessionVersion: number };

/**
 * Hash del email ya normalizado: la tabla de intentos nunca guarda el email en claro. Con secreto
 * (`LOGIN_ATTEMPTS_HMAC_SECRET`) es un HMAC-SHA256, que no se puede asociar a una persona probando direcciones
 * conocidas; sin secreto, el sha256 de siempre.
 */
export function loginEmailHash(
  email: string,
  secret: string | undefined = process.env.LOGIN_ATTEMPTS_HMAC_SECRET,
): string {
  return secret
    ? createHmac("sha256", secret).update(email).digest("hex")
    : createHash("sha256").update(email).digest("hex");
}

/** Los hashes con los que pudo quedar guardado ese email: el vigente y, con secreto, el sha256 anterior. */
export function loginEmailHashes(email: string): string[] {
  const current = loginEmailHash(email);
  const plain = loginEmailHash(email, "");
  return current === plain ? [current] : [current, plain];
}

const MAX_EMAIL_LENGTH = 254;
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Forma básica de un email, con el largo máximo de una dirección: lo demás no reserva intentos. */
function isPlausibleEmail(email: string): boolean {
  return email.length <= MAX_EMAIL_LENGTH && EMAIL_SHAPE.test(email);
}

/** Largo máximo de una IP en texto (IPv6 con prefijo IPv4 incluido): lo que pase de ahí no es una IP. */
const MAX_IP_LENGTH = 45;

/**
 * IP del pedido de login, o `null` si no hay una que sirva. Toma la primera dirección de `x-forwarded-for`
 * (la plataforma la fija) o `x-real-ip`. Con `null` los intentos caen en el tope por email.
 */
export function loginClientIp(
  request: { headers: { get(name: string): string | null } } | undefined,
): string | null {
  const raw =
    request?.headers.get("x-forwarded-for")?.split(",")[0] ??
    request?.headers.get("x-real-ip") ??
    "";
  const ip = raw.trim().toLowerCase();
  return ip && ip.length <= MAX_IP_LENGTH && /^[0-9a-f:.]+$/.test(ip) ? ip : null;
}

/** sha256 de la IP: la tabla de intentos nunca guarda la IP en claro. `null` si no hay IP. */
export function loginIpHash(ip: string | null): string | null {
  return ip ? createHash("sha256").update(`ip:${ip}`).digest("hex") : null;
}

const DEFAULT_VERIFY_MS = 100;
const MAX_VERIFY_WAIT_MS = 2_000;

type PacerClock = { now(): number; sleep(ms: number): Promise<void> };

const realClock: PacerClock = {
  now: () => performance.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/** Mide cada verificación para que la espera sin verificar dure lo mismo que la última medida. */
export function createVerificationPacer(
  verify: LoginDeps["verifyPassword"],
  clock: PacerClock = realClock,
): Pick<LoginDeps, "verifyPassword" | "waitLikeVerification"> {
  let lastMs = DEFAULT_VERIFY_MS;
  return {
    async verifyPassword(password, stored) {
      const start = clock.now();
      try {
        return await verify(password, stored);
      } finally {
        lastMs = Math.min(clock.now() - start, MAX_VERIFY_WAIT_MS);
      }
    },
    waitLikeVerification: () => clock.sleep(lastMs),
  };
}

/**
 * Valida email y contraseña. El intento se cuenta exista o no la cuenta, y la respuesta es siempre `null`:
 * ni el bloqueo ni el tiempo de respuesta distinguen un email registrado de uno que no lo está.
 */
export async function authorizeCredentials(
  deps: LoginDeps,
  credentials: Partial<Record<"email" | "password", unknown>> | undefined,
  clientIp: string | null = null,
): Promise<LoginUser | null> {
  const email = String(credentials?.email ?? "")
    .trim()
    .toLowerCase();
  const password = String(credentials?.password ?? "");
  if (!email || !password) return null;
  // Un email que no puede existir no reserva intento ni crea fila: responde igual y tarda parecido.
  if (!isPlausibleEmail(email)) {
    await deps.waitLikeVerification();
    return null;
  }

  const emailHash = loginEmailHash(email);
  if (!(await deps.beginAttempt(emailHash, loginIpHash(clientIp)))) {
    await deps.waitLikeVerification();
    return null;
  }

  const user = await deps.findUser(email);
  // Con email inexistente se verifica igual contra un hash de relleno (enumeración de cuentas).
  const passwordOk = await deps.verifyPassword(
    password,
    user?.password_hash ?? DUMMY_PASSWORD_HASH,
  );
  if (!user || !passwordOk) return null;

  await deps.clearAttempts(emailHash);
  return { id: user.id, email, sessionVersion: await deps.sessionVersion(user.id) };
}
