import { randomBytes } from "node:crypto";

const ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";
const TOKEN_LENGTH = 20;

/**
 * Dirección de ingesta del seed: aleatoria, igual que en el registro. Si la cuenta ya tiene una aleatoria
 * se conserva y solo se actualiza el dominio, así volver a sembrar no rompe un reenvío ya configurado.
 */
export function seedInboundAddress(existing: string | null | undefined, domain: string): string {
  const current = /^u_([a-z2-7]{20})@/.exec(existing?.toLowerCase() ?? "")?.[1];
  // 32 divide a 256: cada byte da un carácter sin sesgo
  const token = current ?? Array.from(randomBytes(TOKEN_LENGTH), (b) => ALPHABET[b % 32]).join("");
  return `u_${token}@${domain}`.toLowerCase();
}
