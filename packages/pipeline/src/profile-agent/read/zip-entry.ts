/**
 * Ubica una entrada de un ZIP (un DOCX) por el directorio central, sin descomprimir nada. Pura: la
 * descompresión (`DecompressionStream("deflate-raw")`) la hace el navegador, que no tiene que implementar
 * un lector de ZIP. Sin dependencias (ADR-034 §11).
 *
 * Falla cerrado ante lo raro: entradas cifradas, métodos que no sean «sin comprimir» o deflate, tamaños que
 * no cierran con el archivo, o una entrada que declara más de `CV_MAX_DOCX_INFLATED_BYTES` al
 * descomprimirse (bomba de descompresión). El tamaño declarado lo vuelve a verificar quien descomprime.
 */
import { CV_MAX_DOCX_INFLATED_BYTES, CV_MAX_ZIP_ENTRIES } from "../../cv/limits";
import { err, ok, type Result } from "../../result";

export type ZipEntryError =
  | "not_zip"
  | "too_many_entries"
  | "not_found"
  | "encrypted"
  | "unsupported_method"
  | "too_large"
  | "corrupt";

export type ZipEntry = {
  name: string;
  /** 0 = sin comprimir, 8 = deflate. */
  method: 0 | 8;
  compressedSize: number;
  uncompressedSize: number;
  /** Rango de los bytes de la entrada (ya sin el encabezado local). */
  start: number;
  end: number;
};

const EOCD_MIN = 22;
const EOCD_MAX_BACK = 65_557;

const u16 = (b: Uint8Array, at: number): number => b[at]! | (b[at + 1]! << 8);
const u32 = (b: Uint8Array, at: number): number =>
  (b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16) | (b[at + 3]! << 24)) >>> 0;

export function findZipEntry(bytes: Uint8Array, name: string): Result<ZipEntry, ZipEntryError> {
  if (bytes.length < EOCD_MIN) return err("not_zip");
  let eocd = -1;
  const lowest = Math.max(0, bytes.length - EOCD_MAX_BACK);
  for (let i = bytes.length - EOCD_MIN; i >= lowest; i--) {
    if (
      bytes[i] === 0x50 &&
      bytes[i + 1] === 0x4b &&
      bytes[i + 2] === 0x05 &&
      bytes[i + 3] === 0x06
    ) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return err("not_zip");
  const total = u16(bytes, eocd + 10);
  if (total > CV_MAX_ZIP_ENTRIES) return err("too_many_entries");
  let pos = u32(bytes, eocd + 16);
  const decoder = new TextDecoder("utf-8");
  for (let n = 0; n < total; n++) {
    if (
      pos + 46 > bytes.length ||
      bytes[pos] !== 0x50 ||
      bytes[pos + 1] !== 0x4b ||
      bytes[pos + 2] !== 0x01 ||
      bytes[pos + 3] !== 0x02
    ) {
      return err("corrupt");
    }
    const flags = u16(bytes, pos + 8);
    const method = u16(bytes, pos + 10);
    const compressedSize = u32(bytes, pos + 20);
    const uncompressedSize = u32(bytes, pos + 24);
    const nameLen = u16(bytes, pos + 28);
    const extraLen = u16(bytes, pos + 30);
    const commentLen = u16(bytes, pos + 32);
    const localOffset = u32(bytes, pos + 42);
    if (pos + 46 + nameLen > bytes.length) return err("corrupt");
    const entryName = decoder.decode(bytes.subarray(pos + 46, pos + 46 + nameLen));
    if (entryName === name) {
      if ((flags & 0x1) !== 0) return err("encrypted");
      if (method !== 0 && method !== 8) return err("unsupported_method");
      if (uncompressedSize > CV_MAX_DOCX_INFLATED_BYTES) return err("too_large");
      // Encabezado local: 30 bytes más nombre y extra (los largos del local pueden diferir del central)
      if (
        localOffset + 30 > bytes.length ||
        bytes[localOffset] !== 0x50 ||
        bytes[localOffset + 1] !== 0x4b ||
        bytes[localOffset + 2] !== 0x03 ||
        bytes[localOffset + 3] !== 0x04
      ) {
        return err("corrupt");
      }
      const start = localOffset + 30 + u16(bytes, localOffset + 26) + u16(bytes, localOffset + 28);
      const end = start + compressedSize;
      if (end > bytes.length || (method === 0 && compressedSize !== uncompressedSize)) {
        return err("corrupt");
      }
      return ok({ name: entryName, method, compressedSize, uncompressedSize, start, end });
    }
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return err("not_found");
}
