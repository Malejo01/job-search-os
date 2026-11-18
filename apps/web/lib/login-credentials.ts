import { createHash } from "node:crypto";

/** Hash scrypt válido que ninguna contraseña verifica (sal y hash en cero): solo iguala el costo del login. */
const DUMMY_PASSWORD_HASH = `scrypt$${"0".repeat(32)}$${"0".repeat(128)}`;

export type LoginDeps = {
  /** Reserva un intento para ese email. `false`: está en espera y no se verifica nada. */
  beginAttempt(emailHash: string): Promise<boolean>;
  clearAttempts(emailHash: string): Promise<void>;
  findUser(email: string): Promise<{ id: string; password_hash: string | null } | undefined>;
  verifyPassword(password: string, stored: string): Promise<boolean>;
  sessionVersion(userId: string): Promise<number>;
};

export type LoginUser = { id: string; email: string; sessionVersion: number };

/** sha256 del email ya normalizado: la tabla de intentos nunca guarda el email en claro. */
export function loginEmailHash(email: string): string {
  return createHash("sha256").update(email).digest("hex");
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
  if (!(await deps.beginAttempt(emailHash))) return null;

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
