import { createHash } from "node:crypto";

/** Hash scrypt válido que ninguna contraseña verifica (sal y hash en cero): solo iguala el costo del login. */
const DUMMY_PASSWORD_HASH = `scrypt$${"0".repeat(32)}$${"0".repeat(128)}`;

export type LoginDeps = {
  /** Reserva un intento para ese email. `false`: está en espera y no se verifica nada. */
  beginAttempt(emailHash: string): Promise<boolean>;
  clearAttempts(emailHash: string): Promise<void>;
  findUser(email: string): Promise<{ id: string; password_hash: string | null } | undefined>;
  verifyPassword(password: string, stored: string): Promise<boolean>;
  /** Espera lo que tarda una verificación: un intento en espera responde en un tiempo parecido. */
  waitLikeVerification(): Promise<void>;
  sessionVersion(userId: string): Promise<number>;
};

export type LoginUser = { id: string; email: string; sessionVersion: number };

/** sha256 del email ya normalizado: la tabla de intentos nunca guarda el email en claro. */
export function loginEmailHash(email: string): string {
  return createHash("sha256").update(email).digest("hex");
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
): Promise<LoginUser | null> {
  const email = String(credentials?.email ?? "")
    .trim()
    .toLowerCase();
  const password = String(credentials?.password ?? "");
  if (!email || !password) return null;

  const emailHash = loginEmailHash(email);
  if (!(await deps.beginAttempt(emailHash))) {
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
