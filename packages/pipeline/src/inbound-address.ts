/**
 * Dirección de email entrante por usuario (JS-095): `u_<20 caracteres base32>@<dominio>`.
 * 20 caracteres son 100 bits: no se adivina. Parte pura; los bytes aleatorios los pasa quien llama.
 */

const ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";
const TOKEN_LENGTH = 20;

/** Bytes mínimos para cubrir 100 bits (13 bytes = 104 bits). */
export const INBOUND_TOKEN_BYTES = 13;

/** Base32 en minúscula, 20 caracteres, de los primeros 13 bytes. */
export function tokenFromBytes(bytes: Uint8Array): string {
  if (bytes.length < INBOUND_TOKEN_BYTES) {
    throw new Error(`se necesitan al menos ${INBOUND_TOKEN_BYTES} bytes`);
  }
  let out = "";
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5 && out.length < TOKEN_LENGTH) {
      out += ALPHABET[(buffer >>> (bits - 5)) & 31];
      bits -= 5;
    }
    buffer &= (1 << bits) - 1;
    if (out.length === TOKEN_LENGTH) break;
  }
  return out;
}

export function isInboundToken(token: string): boolean {
  return /^[a-z2-7]{20}$/.test(token);
}

export function formatInboundAddress(localToken: string, domain: string): string {
  return `u_${localToken}@${domain}`.toLowerCase();
}

/** ¿Es la dirección vieja, derivada de los primeros 8 hex del id? */
export function isLegacyInboundAddress(address: string, userId: string): boolean {
  const m = /^u_([0-9a-f]{8})@/.exec(address.toLowerCase());
  return m !== null && m[1] === userId.slice(0, 8).toLowerCase();
}
