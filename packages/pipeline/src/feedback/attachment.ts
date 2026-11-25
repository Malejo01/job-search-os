/**
 * Adjuntos del informe de revisión (R29-04). Puro: sin I/O ni hora implícita (ADR-001). Lo usan las rutas
 * `POST/GET/DELETE /api/feedback-files` (`apps/web/lib/feedback-files.ts`).
 *
 * El tipo sale de los bytes, nunca de la extensión ni del `Content-Type`. Todo falla cerrado:
 * - Imágenes: el navegador siempre manda WebP; el servidor lo reescribe dejando solo los chunks de imagen
 *   (sin EXIF, XMP ni perfil de color) y valida ancho y alto. Un PNG o JPEG directo se rechaza.
 * - PDF: se rechazan los nombres que activan código, archivos embebidos o acciones automáticas.
 * - DOCX: se lee el directorio central del ZIP sin descomprimir; se rechazan macros, objetos embebidos,
 *   rutas peligrosas, entradas cifradas, bombas de compresión y entradas superpuestas.
 */
import { readCap } from "../cap-env";

export const ATTACHMENT_KINDS = ["image", "pdf", "docx"] as const;
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];

const MB = 1024 * 1024;
export const ITEM_ATTACHMENTS_MAX = 10;
/** Tope de la imagen que se acepta antes de comprimir (el navegador la achica; el servidor solo ve WebP). */
export const IMAGE_MAX_BYTES = 8 * MB;
/** La imagen ya comprimida (lo que se guarda). */
export const IMAGE_STORED_MAX_BYTES = Math.floor(1.5 * MB);
export const DOCUMENT_MAX_BYTES = 10 * MB;
export const PERSON_FILES_MAX_BYTES = 100 * MB;
/** Límite físico de una función de Vercel: 4,5 MB por pedido. La subida acepta hasta 4 MB. */
export const FEEDBACK_UPLOAD_REQUEST_MAX_BYTES = 4 * MB;
/** Margen del multipart (cabeceras de partes y el `itemId`) sobre el tope del archivo. */
export const FEEDBACK_UPLOAD_MULTIPART_OVERHEAD_BYTES = 64 * 1024;
export const FEEDBACK_FILES_GLOBAL_MAX_BYTES = 400 * MB;
/** Subidas por persona, contadas en la base. */
export const ATTACHMENT_UPLOADS_PER_MINUTE = 20;
export const ATTACHMENT_UPLOADS_PER_DAY = 300;
export const ATTACHMENT_NAME_MAX = 120;

export const WEBP_DIMENSION_MAX = 4000;
export const DOCX_MAX_ENTRIES = 2000;
export const DOCX_MAX_UNCOMPRESSED_BYTES = 50 * MB;
const DOCX_MAX_RATIO = 100;
const DOCX_RATIO_MIN_BYTES = 1 * MB;

export const ATTACHMENT_MIME = {
  webp: "image/webp",
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
} as const;

/** Tope global en bytes desde `FEEDBACK_FILES_GLOBAL_MAX_MB` (entero; inválido = 400 MB). */
export function feedbackFilesGlobalMaxBytes(env: Record<string, string | undefined>): number {
  return (
    readCap(env, "FEEDBACK_FILES_GLOBAL_MAX_MB", FEEDBACK_FILES_GLOBAL_MAX_BYTES / MB, {
      kind: "int",
      max: 10_000,
    }) * MB
  );
}

// ---------------------------------------------------------------------------------------------------------
// Limpieza de adjuntos de lo resuelto (R29-09). La regla vive en la base (`purge_resolved_attachments`,
// rls/0070); esta es la misma regla en código puro, para los tests y para mostrar qué se va a borrar.
// ---------------------------------------------------------------------------------------------------------

/** Días desde que el ítem pasó a «resuelto» antes de que sus adjuntos se puedan borrar solos. */
export const ATTACHMENT_PURGE_DAYS = 30;

/**
 * ¿Se puede borrar este adjunto? Solo si su ítem está en `resuelto`, el informe no es borrador, todavía no se
 * borró y pasaron `days` días desde `statusChangedAt`. Sin fecha, con fecha inválida o con `days` inválido: no.
 */
export function isPurgeable(
  att: {
    itemStatus: string;
    reportStatus: string;
    alreadyDeleted: boolean;
    statusChangedAt: Date | null;
  },
  now: Date,
  days: number = ATTACHMENT_PURGE_DAYS,
): boolean {
  if (att.alreadyDeleted || att.itemStatus !== "resuelto" || att.reportStatus === "borrador")
    return false;
  if (!Number.isFinite(days) || days < 1) return false;
  const changed = att.statusChangedAt?.getTime();
  if (changed === undefined || !Number.isFinite(changed) || !Number.isFinite(now.getTime()))
    return false;
  return changed <= now.getTime() - days * 86_400_000;
}

/** Lo que queda en lugar del archivo: el texto del ítem se conserva y esto avisa qué había. */
export function purgedNote(a: { name: string; bytes: number; deletedAt: Date }): string {
  const day = Number.isNaN(a.deletedAt.getTime())
    ? "fecha desconocida"
    : a.deletedAt.toISOString().slice(0, 10);
  const size =
    a.bytes >= MB
      ? `${(a.bytes / MB).toFixed(1).replace(".", ",")} MB`
      : `${Math.max(1, Math.round(a.bytes / 1024))} KB`;
  return `Adjunto borrado el ${day}: ${a.name} (${size})`;
}

/** Interruptor del cron diario de limpieza: apagado salvo `ATTACHMENTS_PURGE_ENABLED=1` (los botones del admin no lo usan). */
export function attachmentsPurgeEnabled(env: Record<string, string | undefined>): boolean {
  return env.ATTACHMENTS_PURGE_ENABLED?.trim() === "1";
}

export type AttachmentRejectReason =
  | "invalid_input"
  | "empty"
  | "request_too_large"
  | "item_full"
  | "type"
  | "image_reencode"
  | "corrupt"
  | "too_large"
  | "unsafe_pdf"
  | "unsafe_docx"
  | "person_quota"
  | "global_quota";

/** Los de la validación más los de la ruta HTTP. */
export type AttachmentErrorCode =
  | AttachmentRejectReason
  | "rate_limited"
  | "no_session"
  | "forbidden"
  | "not_found"
  | "report_locked"
  | "bad_request"
  | "server_error";

/** Texto en llano de cada código (voseo). Los reutiliza la UI del informe. */
export const ATTACHMENT_ERROR_TEXTS: Record<AttachmentErrorCode, string> = {
  invalid_input: "No pudimos revisar el archivo. Probá de nuevo.",
  empty: "El archivo está vacío.",
  request_too_large: "Por ahora, documentos de hasta 4 MB.",
  item_full: "Este ítem ya tiene el máximo de 10 adjuntos.",
  type: "Ese tipo de archivo no se puede adjuntar. Aceptamos capturas, PDF y documentos de Word (.docx).",
  image_reencode: "Volvé a elegir la imagen.",
  corrupt: "No pudimos leer la imagen. Probá con otra captura.",
  too_large: "El archivo es demasiado grande.",
  unsafe_pdf: "Ese PDF tiene contenido activo y no se puede adjuntar. Probá exportándolo de nuevo.",
  unsafe_docx:
    "Ese documento de Word tiene contenido que no aceptamos (macros, objetos embebidos o estructura rara).",
  person_quota: "Llegaste al máximo de archivos adjuntos que podés guardar.",
  global_quota: "Por ahora no podemos guardar más adjuntos. Avisanos y lo resolvemos.",
  rate_limited: "Estás subiendo muy rápido. Esperá un momento y probá de nuevo.",
  no_session: "Tu sesión venció. Volvé a entrar y probá de nuevo.",
  forbidden: "No tenés permiso para hacer eso.",
  not_found: "No encontramos ese archivo.",
  report_locked: "El informe ya se envió: no se puede cambiar.",
  bad_request: "El pedido no es válido.",
  server_error: "Algo falló de nuestro lado. Probá de nuevo en un rato.",
};

// ---------------------------------------------------------------------------------------------------------
// Tipo por los bytes
// ---------------------------------------------------------------------------------------------------------

export type SniffedFormat = "png" | "jpeg" | "webp" | "pdf" | "zip";

const startsWith = (b: Uint8Array, sig: number[], at = 0) =>
  b.length >= at + sig.length && sig.every((v, i) => b[at + i] === v);

/** El formato que dicen los primeros bytes. `null` para SVG, HTML, GIF, vacío y todo lo demás. */
export function sniffAttachment(b: Uint8Array): SniffedFormat | null {
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (startsWith(b, [0xff, 0xd8, 0xff])) return "jpeg";
  if (startsWith(b, [0x52, 0x49, 0x46, 0x46]) && startsWith(b, [0x57, 0x45, 0x42, 0x50], 8))
    return "webp";
  if (startsWith(b, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "pdf";
  if (startsWith(b, [0x50, 0x4b, 0x03, 0x04])) return "zip";
  return null;
}

// ---------------------------------------------------------------------------------------------------------
// WebP: reescritura
// ---------------------------------------------------------------------------------------------------------

export type WebpResult =
  { ok: true; bytes: Uint8Array; width: number; height: number } | { ok: false; reason: "corrupt" };

const fourcc = (b: Uint8Array, at: number) =>
  String.fromCharCode(b[at]!, b[at + 1]!, b[at + 2]!, b[at + 3]!);
const rd16 = (b: Uint8Array, at: number) => b[at]! | (b[at + 1]! << 8);
const rd24 = (b: Uint8Array, at: number) => b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16);
const rd32 = (b: Uint8Array, at: number) =>
  (b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16) | (b[at + 3]! << 24)) >>> 0;
const wr32 = (n: number) =>
  Uint8Array.of(n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff);
const ascii = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function makeChunk(id: string, data: Uint8Array): Uint8Array {
  return concatBytes([
    ascii(id),
    wr32(data.length),
    data,
    data.length % 2 ? Uint8Array.of(0) : new Uint8Array(0),
  ]);
}

function dimsOk(w: number, h: number) {
  return w >= 1 && h >= 1 && w <= WEBP_DIMENSION_MAX && h <= WEBP_DIMENSION_MAX;
}

/** Ancho y alto del chunk `VP8 ` (lossy) o `VP8L`; `null` si la cabecera no es válida. */
function imageChunkDims(id: string, d: Uint8Array): { w: number; h: number } | null {
  if (id === "VP8 ") {
    if (d.length < 10 || (d[0]! & 1) !== 0) return null; // 1.er bit en 0: cuadro clave
    if (d[3] !== 0x9d || d[4] !== 0x01 || d[5] !== 0x2a) return null;
    return { w: rd16(d, 6) & 0x3fff, h: rd16(d, 8) & 0x3fff };
  }
  if (d.length < 5 || d[0] !== 0x2f) return null;
  const v = rd32(d, 1);
  return { w: (v & 0x3fff) + 1, h: ((v >>> 14) & 0x3fff) + 1 };
}

/**
 * Reescribe un WebP dejando solo `VP8X` (con ICC, EXIF y XMP apagados), `ALPH` y el chunk de imagen
 * (`VP8 ` o `VP8L`). Descarta todo lo demás y los bytes que sobran después del RIFF. Valida el largo de cada
 * chunk y que ancho y alto estén entre 1 y 4.000. Los animados se rechazan.
 */
export function sanitizeWebp(b: Uint8Array): WebpResult {
  const bad: WebpResult = { ok: false, reason: "corrupt" };
  if (sniffAttachment(b) !== "webp" || b.length < 20) return bad;
  const end = 8 + rd32(b, 4);
  if (end > b.length || end < 20) return bad;

  let vp8x: Uint8Array | null = null;
  let alph: Uint8Array | null = null;
  let image: { id: string; data: Uint8Array } | null = null;
  let pos = 12;
  let first = true;
  while (pos + 8 <= end) {
    const id = fourcc(b, pos);
    const size = rd32(b, pos + 4);
    const start = pos + 8;
    if (start + size > end) return bad;
    const data = b.slice(start, start + size);
    if (id === "VP8X") {
      if (!first || vp8x) return bad;
      vp8x = data;
    } else if (id === "ALPH") {
      if (!vp8x || alph || image) return bad;
      alph = data;
    } else if (id === "VP8 " || id === "VP8L") {
      if (image) return bad;
      image = { id, data };
    }
    first = false;
    pos = start + size + (size & 1);
  }
  const over = pos - end;
  if (over !== 0 && over !== 1) return bad;
  if (!image) return bad;
  if (alph && image.id !== "VP8 ") return bad;

  const dims = imageChunkDims(image.id, image.data);
  if (!dims || !dimsOk(dims.w, dims.h)) return bad;

  const parts: Uint8Array[] = [];
  if (vp8x) {
    if (vp8x.length !== 10) return bad;
    const flags = vp8x[0]!;
    if (flags & 0x02) return bad; // animado
    if (rd24(vp8x, 4) + 1 !== dims.w || rd24(vp8x, 7) + 1 !== dims.h) return bad;
    const clean = new Uint8Array(10);
    clean[0] = flags & 0x10; // solo el bit de transparencia
    clean.set(vp8x.slice(4, 10), 4);
    parts.push(makeChunk("VP8X", clean));
    if (alph) parts.push(makeChunk("ALPH", alph));
  }
  parts.push(makeChunk(image.id, image.data));
  const body = concatBytes([ascii("WEBP"), ...parts]);
  return {
    ok: true,
    bytes: concatBytes([ascii("RIFF"), wr32(body.length), body]),
    width: dims.w,
    height: dims.h,
  };
}

// ---------------------------------------------------------------------------------------------------------
// Nombre de archivo
// ---------------------------------------------------------------------------------------------------------

/** Control (C0 y C1), espacios de ancho cero, marcas y controles de dirección (bidi) y BOM. */
function isUnsafeChar(cp: number): boolean {
  return (
    cp <= 0x1f ||
    (cp >= 0x7f && cp <= 0x9f) ||
    (cp >= 0x200b && cp <= 0x200f) ||
    (cp >= 0x202a && cp <= 0x202e) ||
    (cp >= 0x2060 && cp <= 0x2069) ||
    cp === 0xfeff
  );
}
const stripUnsafeChars = (text: string): string =>
  Array.from(text)
    .filter((c) => !isUnsafeChar(c.codePointAt(0)!))
    .join("");
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/**
 * Nombre seguro para mostrar y para `Content-Disposition`: sin ruta, sin control ni bidi, sin `..`, de hasta
 * 120 caracteres. Si se pasa `ext` (la del tipo detectado), esa es la extensión; si no, se conserva la
 * original solo si es alfanumérica y corta.
 */
export function sanitizeFileName(name: string, ext?: string): string {
  let s = stripUnsafeChars(String(name ?? "").normalize("NFC"));
  s = s.slice(s.search(/[^/\\]*$/));
  s = s.replace(/[<>:"|?*]/g, "_").replace(/\.{2,}/g, ".");
  const dot = s.lastIndexOf(".");
  let base = dot > 0 ? s.slice(0, dot) : s;
  const origExt = dot > 0 ? s.slice(dot + 1) : "";
  base = base.replace(/^[\s.]+|[\s.]+$/g, "");
  if (base === "") base = "adjunto";
  if (RESERVED.test(base)) base = `_${base}`;
  const finalExt = (
    ext ?? (/^[A-Za-z0-9]{1,5}$/.test(origExt) ? origExt.toLowerCase() : "")
  ).toLowerCase();
  const suffix = finalExt ? `.${finalExt}` : "";
  base = Array.from(base)
    .slice(0, ATTACHMENT_NAME_MAX - suffix.length)
    .join("")
    .replace(/[\s.]+$/g, "");
  return `${base || "adjunto"}${suffix}`;
}

// ---------------------------------------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------------------------------------

const PDF_BANNED_NAMES = new Set([
  "JavaScript",
  "JS",
  "Launch",
  "EmbeddedFile",
  "EmbeddedFiles",
  "OpenAction",
  "AA",
  "RichMedia",
  "XFA",
  "Encrypt",
]);

function indexOfBytes(b: Uint8Array, sig: number[], from = 0): number {
  const limit = b.length - sig.length;
  outer: for (let i = from; i <= limit; i++) {
    for (let j = 0; j < sig.length; j++) if (b[i + j] !== sig[j]) continue outer;
    return i;
  }
  return -1;
}

/** `true` si el PDF no trae nombres de acciones activas ni parece un ZIP escondido. */
function pdfIsClean(b: Uint8Array): boolean {
  // Polyglot PDF + ZIP: cabecera local y fin de directorio central en el mismo archivo.
  if (indexOfBytes(b, [0x50, 0x4b, 0x03, 0x04]) !== -1) {
    const tail = Math.max(0, b.length - 65_557);
    if (indexOfBytes(b, [0x50, 0x4b, 0x05, 0x06], tail) !== -1) return false;
  }
  const text = new TextDecoder("latin1").decode(b);
  for (const m of text.matchAll(/\/[^\s/[\]<>(){}%]+/g)) {
    // Los nombres admiten `#xx` (p. ej. `/J#61vaScript`): se decodifican antes de comparar.
    const name = m[0]
      .slice(1)
      .replace(/#([0-9a-fA-F]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
    if (PDF_BANNED_NAMES.has(name)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------------------------------------
// DOCX (ZIP): solo el directorio central, sin descomprimir
// ---------------------------------------------------------------------------------------------------------

const DOCX_BANNED_NAME =
  /vbaproject|vbadata|oleobject|activex|(^|\/)embeddings\/|\.(bin|exe|dll|bat|cmd|vbs|js|ps1|scr|jar|lnk)$/i;

function docxIsSafe(b: Uint8Array): boolean {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  // Fin del directorio central: el comentario tiene que cerrar justo en el último byte (nada de cola).
  let eocd = -1;
  for (let p = b.length - 22; p >= Math.max(0, b.length - 22 - 0xffff); p--) {
    if (v.getUint32(p, true) === 0x06054b50 && p + 22 + v.getUint16(p + 20, true) === b.length) {
      eocd = p;
      break;
    }
  }
  if (eocd < 0) return false;
  const disk = v.getUint16(eocd + 4, true);
  const cdDisk = v.getUint16(eocd + 6, true);
  const onDisk = v.getUint16(eocd + 8, true);
  const total = v.getUint16(eocd + 10, true);
  const cdSize = v.getUint32(eocd + 12, true);
  const cdOffset = v.getUint32(eocd + 16, true);
  if (disk !== 0 || cdDisk !== 0 || onDisk !== total) return false;
  if (total === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) return false; // ZIP64
  if (total === 0 || total > DOCX_MAX_ENTRIES) return false;
  if (cdOffset + cdSize !== eocd) return false;

  const names = new Set<string>();
  const entries: { offset: number; dataEnd: number }[] = [];
  const dec = new TextDecoder("utf-8");
  let totalUncompressed = 0;
  let totalCompressed = 0;
  let p = cdOffset;
  for (let i = 0; i < total; i++) {
    if (p + 46 > eocd || v.getUint32(p, true) !== 0x02014b50) return false;
    const flags = v.getUint16(p + 8, true);
    const method = v.getUint16(p + 10, true);
    const comp = v.getUint32(p + 20, true);
    const uncomp = v.getUint32(p + 24, true);
    const nameLen = v.getUint16(p + 28, true);
    const extraLen = v.getUint16(p + 30, true);
    const commentLen = v.getUint16(p + 32, true);
    const offset = v.getUint32(p + 42, true);
    if (p + 46 + nameLen + extraLen + commentLen > eocd) return false;
    const nameBytes = b.subarray(p + 46, p + 46 + nameLen);
    const name = dec.decode(nameBytes);
    p += 46 + nameLen + extraLen + commentLen;

    if (flags & 0x1) return false; // cifrada
    if (method !== 0 && method !== 8) return false;
    if (method === 0 && comp !== uncomp) return false;
    if (comp === 0xffffffff || uncomp === 0xffffffff) return false;
    // eslint-disable-next-line no-control-regex
    if (nameLen === 0 || /[\u0000-\u001f\u007f]/.test(name)) return false;
    if (
      name.includes("\\") ||
      name.includes("..") ||
      name.startsWith("/") ||
      /^[A-Za-z]:/.test(name)
    )
      return false;
    if (DOCX_BANNED_NAME.test(name)) return false;
    if (names.has(name)) return false;
    names.add(name);

    totalUncompressed += uncomp;
    totalCompressed += comp;
    if (totalUncompressed > DOCX_MAX_UNCOMPRESSED_BYTES) return false;

    // El encabezado local tiene que existir, coincidir en el nombre y no pisar a otra entrada.
    if (offset + 30 > cdOffset || v.getUint32(offset, true) !== 0x04034b50) return false;
    const lNameLen = v.getUint16(offset + 26, true);
    const lExtraLen = v.getUint16(offset + 28, true);
    if (lNameLen !== nameLen) return false;
    const lName = b.subarray(offset + 30, offset + 30 + lNameLen);
    if (lName.length !== nameLen || lName.some((x, k) => x !== nameBytes[k])) return false;
    const dataEnd = offset + 30 + lNameLen + lExtraLen + comp;
    if (dataEnd > cdOffset) return false;
    entries.push({ offset, dataEnd });
  }
  if (p !== eocd) return false;
  if (
    totalUncompressed > DOCX_RATIO_MIN_BYTES &&
    totalUncompressed / Math.max(1, totalCompressed) > DOCX_MAX_RATIO
  ) {
    return false;
  }
  if (!names.has("[Content_Types].xml") || !names.has("word/document.xml")) return false;

  entries.sort((x, y) => x.offset - y.offset);
  if (entries[0]!.offset !== 0) return false; // nada antes del primer encabezado
  for (let i = 0; i < entries.length; i++) {
    const next = i + 1 < entries.length ? entries[i + 1]!.offset : cdOffset;
    const gap = next - entries[i]!.dataEnd;
    if (gap < 0 || gap > 24) return false; // superpuestas o con bytes escondidos entre medio
  }
  return true;
}

// ---------------------------------------------------------------------------------------------------------
// Validación completa de una subida
// ---------------------------------------------------------------------------------------------------------

export type AttachmentCheck =
  | {
      ok: true;
      kind: AttachmentKind;
      mime: (typeof ATTACHMENT_MIME)[keyof typeof ATTACHMENT_MIME];
      /** Lo que se guarda: el WebP reescrito, o el PDF/DOCX tal cual. */
      bytes: Uint8Array;
      width: number | null;
      height: number | null;
      /** Nombre saneado con la extensión del tipo detectado. */
      name: string;
    }
  | { ok: false; reason: AttachmentRejectReason };

const reject = (reason: AttachmentRejectReason): AttachmentCheck => ({ ok: false, reason });
const validCount = (n: number) => Number.isFinite(n) && n >= 0;

/**
 * Valida un archivo antes de guardarlo. `itemCount`: adjuntos que ya tiene el ítem; `personBytes` y
 * `globalBytes`: lo guardado hasta ahora por la persona y por todos. Los topes por persona y global se
 * pueden pasar para que el borde use el valor de su variable de entorno.
 */
export function validateAttachmentUpload(input: {
  bytes: Uint8Array;
  name: string;
  itemCount: number;
  personBytes: number;
  globalBytes: number;
  personMaxBytes?: number;
  globalMaxBytes?: number;
}): AttachmentCheck {
  const { bytes } = input;
  if (![input.itemCount, input.personBytes, input.globalBytes].every(validCount))
    return reject("invalid_input");
  if (bytes.length === 0) return reject("empty");
  if (bytes.length > FEEDBACK_UPLOAD_REQUEST_MAX_BYTES) return reject("request_too_large");
  if (input.itemCount >= ITEM_ATTACHMENTS_MAX) return reject("item_full");

  const format = sniffAttachment(bytes);
  if (!format) return reject("type");

  let stored: Uint8Array;
  let kind: AttachmentKind;
  let mime: (typeof ATTACHMENT_MIME)[keyof typeof ATTACHMENT_MIME];
  let width: number | null = null;
  let height: number | null = null;
  let ext: string;

  if (format === "png" || format === "jpeg") return reject("image_reencode");
  if (format === "webp") {
    if (bytes.length > IMAGE_MAX_BYTES) return reject("too_large");
    const w = sanitizeWebp(bytes);
    if (!w.ok) return reject("corrupt");
    if (w.bytes.length > IMAGE_STORED_MAX_BYTES) return reject("too_large");
    stored = w.bytes;
    kind = "image";
    mime = ATTACHMENT_MIME.webp;
    width = w.width;
    height = w.height;
    ext = "webp";
  } else if (format === "pdf") {
    if (bytes.length > DOCUMENT_MAX_BYTES) return reject("too_large");
    if (!pdfIsClean(bytes)) return reject("unsafe_pdf");
    stored = bytes;
    kind = "pdf";
    mime = ATTACHMENT_MIME.pdf;
    ext = "pdf";
  } else {
    if (bytes.length > DOCUMENT_MAX_BYTES) return reject("too_large");
    if (!docxIsSafe(bytes)) return reject("unsafe_docx");
    stored = bytes;
    kind = "docx";
    mime = ATTACHMENT_MIME.docx;
    ext = "docx";
  }

  const personMax = input.personMaxBytes ?? PERSON_FILES_MAX_BYTES;
  const globalMax = input.globalMaxBytes ?? FEEDBACK_FILES_GLOBAL_MAX_BYTES;
  if (input.personBytes + stored.length > personMax) return reject("person_quota");
  if (input.globalBytes + stored.length > globalMax) return reject("global_quota");

  return {
    ok: true,
    kind,
    mime,
    bytes: stored,
    width,
    height,
    name: sanitizeFileName(input.name, ext),
  };
}
