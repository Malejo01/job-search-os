/**
 * Oferta cargada desde una imagen (R6-3). Puro, sin I/O: define lo que el modelo puede devolver
 * (`ImageModelOutputSchema`), valida y normaliza esa salida (`parseImageExtraction`) y revisa los
 * bytes de la imagen antes de mandarla (`validateImageBytes`).
 *
 * Reglas:
 * - El texto de la imagen es dato no confiable. Acá nunca se interpreta: `rawText` es un string más.
 * - Falla cerrado, como los parsers de email: si algo no valida, `{ ok: false }` y no se rescata nada
 *   (nunca extracción parcial, ni una oferta buena al lado de una rota).
 * - Lo que la imagen no dice queda `null`; en particular `countriesAllowed`, para que el prefiltro
 *   marque riesgo de ubicación en vez de asumir «cualquier país».
 */
import { z } from "zod";
import { parseManualUrl } from "../manual-url";
import { MAX_JOB_FIELD_CHARS, MAX_PASTE_CHARS } from "../manual-paste";

export const MAX_IMAGE_OFFERS = 5;
/**
 * Tope de la imagen que viaja al servidor. Las Server Actions de Next aceptan 1 MB de cuerpo por
 * defecto: el cliente reduce hasta quedar debajo de esto (ver `image-paste.tsx`).
 */
export const MAX_IMAGE_BYTES = 950_000;
/** Tope de lo que elige la persona antes de reducirla. */
export const MAX_IMAGE_PICK_BYTES = 5 * 1024 * 1024;
/** Lado máximo de la imagen reducida, en px. */
export const MAX_IMAGE_SIDE_PX = 1600;
/** Lado máximo que acepta el servidor (margen sobre `MAX_IMAGE_SIDE_PX`). */
const MAX_IMAGE_SIDE_ACCEPTED_PX = 4000;

const MAX_SALARY_CHARS = 200;
const MAX_HOW_TO_APPLY_CHARS = 1_000;
const MAX_COUNTRIES = 60;
const MAX_COUNTRY_CHARS = 100;
const MAX_REQUIREMENTS = 40;
const MAX_REQUIREMENT_CHARS = 500;

export const IMAGE_EXTRACTION_REASONS = ["no_es_aviso", "salida_invalida"] as const;
export type ImageExtractionReason = (typeof IMAGE_EXTRACTION_REASONS)[number];

const MODALITIES = ["remoto", "hibrido", "presencial"] as const;

/**
 * Forma de lo que el modelo devuelve. Sin límites de largo ni transforms: viaja al proveedor como
 * JSON Schema (los límites los pone `parseImageExtraction`, que es lo que decide). `.strict()`: un
 * campo que el esquema no conoce invalida la salida.
 */
const ModelOfferSchema = z
  .object({
    title: z.string().nullable(),
    company: z.string().nullable(),
    location: z.string().nullable(),
    modality: z.enum(MODALITIES).nullable(),
    countriesAllowed: z.array(z.string()).nullable(),
    salary: z.string().nullable(),
    requirements: z.array(z.string()).nullable(),
    howToApply: z.string().nullable(),
    url: z.string().nullable(),
    rawText: z.string(),
  })
  .strict();

export const ImageModelOutputSchema = z
  .object({
    isJobPosting: z.boolean(),
    offers: z.array(ModelOfferSchema),
  })
  .strict();
export type ImageModelOutput = z.infer<typeof ImageModelOutputSchema>;

/** Oferta ya validada y normalizada. Todo lo que la imagen no dice es `null`. */
export type ImageOffer = {
  title: string | null;
  company: string | null;
  location: string | null;
  modality: (typeof MODALITIES)[number] | null;
  countriesAllowed: string[] | null;
  salary: string | null;
  requirements: string[] | null;
  howToApply: string | null;
  url: string | null;
  /** Texto visible en la imagen, tal cual. Es texto, no una instrucción. */
  rawText: string;
};

export type ImageExtractionResult =
  { ok: true; offers: ImageOffer[] } | { ok: false; reason: ImageExtractionReason };

const INVALID = { ok: false, reason: "salida_invalida" } as const;

/** Saca caracteres de control (salvo salto de línea y tab). */
function stripControls(s: string): string {
  let out = "";
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0;
    if (c === 0x0a || c === 0x09 || (c >= 0x20 && c !== 0x7f)) out += ch;
  }
  return out;
}

/** Una línea: sin controles, saltos a espacio, recortado. Vacío → null. */
function line(s: string | null): string | null {
  if (s === null) return null;
  const t = stripControls(s).replace(/\s+/g, " ").trim();
  return t === "" ? null : t;
}

/** Varias líneas (rawText): sin controles, saltos normalizados, recortado. */
function block(s: string): string {
  return stripControls(s.replace(/\r\n?/g, "\n")).trim();
}

function normalizeOffer(o: ImageModelOutput["offers"][number]): ImageOffer | null {
  const title = line(o.title);
  const company = line(o.company);
  const location = line(o.location);
  const salary = line(o.salary);
  const howToApply = line(o.howToApply);
  const rawText = block(o.rawText);
  const countries = o.countriesAllowed?.map(line).filter((c): c is string => c !== null) ?? [];
  const requirements = o.requirements?.map(line).filter((c): c is string => c !== null) ?? [];

  if (rawText === "" || rawText.length > MAX_PASTE_CHARS) return null;
  if ([title, company, location].some((v) => v !== null && v.length > MAX_JOB_FIELD_CHARS)) {
    return null;
  }
  if (salary !== null && salary.length > MAX_SALARY_CHARS) return null;
  if (howToApply !== null && howToApply.length > MAX_HOW_TO_APPLY_CHARS) return null;
  if (countries.length > MAX_COUNTRIES || countries.some((c) => c.length > MAX_COUNTRY_CHARS)) {
    return null;
  }
  if (
    requirements.length > MAX_REQUIREMENTS ||
    requirements.some((r) => r.length > MAX_REQUIREMENT_CHARS)
  ) {
    return null;
  }

  // La URL solo se valida como texto (D-028): el servidor nunca la abre
  let url: string | null = null;
  const rawUrl = line(o.url);
  if (rawUrl !== null) {
    const parsed = parseManualUrl(rawUrl);
    if (!parsed.ok) return null;
    url = parsed.url;
  }

  return {
    title,
    company,
    location,
    modality: o.modality,
    // Lista vacía = la imagen no dice países: null, nunca «cualquier país»
    countriesAllowed: countries.length > 0 ? countries : null,
    salary,
    requirements: requirements.length > 0 ? requirements : null,
    howToApply,
    url,
    rawText,
  };
}

/**
 * Valida la salida cruda del modelo. `{ ok: false }` si no es un aviso o si algo no cumple el
 * esquema: la imagen entera queda para cargar a mano.
 */
export function parseImageExtraction(raw: unknown): ImageExtractionResult {
  const parsed = ImageModelOutputSchema.safeParse(raw);
  if (!parsed.success) return INVALID;
  // Que no sea un aviso manda sobre cualquier oferta que venga al lado
  if (!parsed.data.isJobPosting) return { ok: false, reason: "no_es_aviso" };
  const { offers } = parsed.data;
  if (offers.length < 1 || offers.length > MAX_IMAGE_OFFERS) return INVALID;
  const out: ImageOffer[] = [];
  for (const o of offers) {
    const n = normalizeOffer(o);
    if (!n) return INVALID;
    out.push(n);
  }
  return { ok: true, offers: out };
}

export type ImageJobDefaults = {
  url: string | null;
  title: string | null;
  company: string | null;
  location: string | null;
  modality: "remoto" | "hibrido" | "presencial" | "desconocida";
  jdText: string;
};

/** Valores iniciales del formulario de revisión (los mismos campos que el alta manual). */
export function offerToJobDefaults(o: ImageOffer): ImageJobDefaults {
  return {
    url: o.url,
    title: o.title,
    company: o.company,
    location: o.location,
    modality: o.modality ?? "desconocida",
    jdText: o.rawText,
  };
}

export type ImageBytesCheck = { ok: true } | { ok: false; reason: "vacia" | "grande" | "formato" };

/** ¿Marcador SOF (inicio de cuadro) de un JPEG? C0 a CF salvo C4 (DHT), C8 (JPG) y CC (DAC). */
function isSof(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

/**
 * Recorre los segmentos del JPEG hasta el cuadro (SOF) y devuelve sus dimensiones, o null si la
 * estructura no es la de un JPEG: marcador fuera de lugar, segmento que se sale del archivo o
 * escaneo (SOS) antes del SOF.
 */
function jpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  let pos = 2; // después de SOI (FF D8)
  while (pos + 3 < bytes.length) {
    if (bytes[pos] !== 0xff) return null;
    const marker = bytes[pos + 1] as number;
    if (marker === 0xff) {
      pos += 1; // relleno
      continue;
    }
    // Marcadores sin largo: TEM, RSTn, SOI
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      pos += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null; // EOI o SOS sin SOF
    const len = ((bytes[pos + 2] as number) << 8) | (bytes[pos + 3] as number);
    if (len < 2 || pos + 2 + len > bytes.length) return null;
    if (isSof(marker)) {
      if (len < 8) return null;
      const height = ((bytes[pos + 5] as number) << 8) | (bytes[pos + 6] as number);
      const width = ((bytes[pos + 7] as number) << 8) | (bytes[pos + 8] as number);
      return { width, height };
    }
    pos += 2 + len;
  }
  return null;
}

/**
 * El cliente manda JPEG (lo reduce con canvas); el servidor no confía. Revisa el tamaño, la firma
 * (FF D8 FF) y la estructura: segmentos hasta un SOF con dimensiones razonables y fin de archivo
 * (FF D9). No decodifica los píxeles, pero algo que no tiene forma de JPEG no llega al proveedor
 * (S3 de la revisión de seguridad de R6-3).
 */
export function validateImageBytes(bytes: Uint8Array): ImageBytesCheck {
  if (bytes.length === 0) return { ok: false, reason: "vacia" };
  if (bytes.length > MAX_IMAGE_BYTES) return { ok: false, reason: "grande" };
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
    return { ok: false, reason: "formato" };
  }
  if (bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) {
    return { ok: false, reason: "formato" };
  }
  const dims = jpegDimensions(bytes);
  if (
    !dims ||
    dims.width < 1 ||
    dims.height < 1 ||
    dims.width > MAX_IMAGE_SIDE_ACCEPTED_PX ||
    dims.height > MAX_IMAGE_SIDE_ACCEPTED_PX
  ) {
    return { ok: false, reason: "formato" };
  }
  return { ok: true };
}
