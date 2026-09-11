import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * Hash de contraseña con scrypt de Node (sin dependencias nativas). Formato:
 * `scrypt$<salt hex>$<hash hex>`. Un solo usuario (ADR-010); si algún día hay registro
 * público se revisa el costo (N) y se agrega rate limit en el login.
 */
const KEY_LENGTH = 64;
const SCRYPT_OPTIONS = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export function hashPassword(password: string): string {
  if (password.length < 8) throw new Error("la contraseña debe tener al menos 8 caracteres");
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, KEY_LENGTH, SCRYPT_OPTIONS).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string | null | undefined): boolean {
  if (!stored) return false;
  const [algo, salt, hash] = stored.split("$");
  if (algo !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "hex");
  const actual = scryptSync(password, salt, expected.length, SCRYPT_OPTIONS);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
