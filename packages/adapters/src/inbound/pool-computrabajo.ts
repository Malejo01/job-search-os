import { createHash } from "node:crypto";
import type { Db } from "@job-search-os/db";
import { MAX_EMAIL_HTML_CHARS, tagBlocks, type SourceKind } from "@job-search-os/pipeline";
import type { Logger } from "../logger";
import { upsertPoolJobs } from "../pool/upsert";
import { readComputrabajoCards } from "./computrabajo";
import type { InboundEmailContent, ParseResult } from "./parsers";

/**
 * Lector de las alertas de Computrabajo para el pool (R19-01, ADR-043; ADR-024 §9). Las alertas llegan a
 * las casillas `pool-<carrera>@` reenviadas desde el Gmail de una persona de la beta. Reusa la lectura de
 * tarjetas del mail de recomendaciones (`computrabajo.ts`) y cambia lo que importa para el pool:
 *   - la fuente es `computrabajo_alerts`, con el nombre «vía Computrabajo» (ADR-024 §4);
 *   - del tracker solo sale la URL pública del aviso y su ID de 32 hex; `ipo`, `idu`, `isd` y los demás
 *     parámetros identifican a quien recibió el email y se descartan (el pool no tiene `user_id`);
 *   - `countriesAllowed` queda null: el email no lo dice.
 * Falla cerrado: estructura desconocida, recordatorio, seguimiento de una empresa, link que no es de
 * Computrabajo, tracker sin `url=` o un email que pasa los topes → `{ ok: false }` y el email entero queda
 * en la cola manual del pool. Nunca extracción parcial.
 *
 * Detrás de `POOL_COMPUTRABAJO_READER` (apagado por defecto): se construyó con la estructura conocida de
 * R11-4 y se valida con el primer email real antes de prenderlo.
 */

/** Valor de `source_kind` de la fuente (migración 0046). */
export const POOL_COMPUTRABAJO_SOURCE_KIND = "computrabajo_alerts" satisfies SourceKind;
export const POOL_COMPUTRABAJO_SOURCE_NAME = "vía Computrabajo";

/** Avisos máximos por email (igual que `EMAIL_MAX_CARDS` del inbound de personas). */
export const POOL_EMAIL_MAX_CARDS = 100;

export function parsePoolComputrabajoAlerts(email: InboundEmailContent): ParseResult {
  const res = readComputrabajoCards(email.html, (aviso) => ({
    kind: POOL_COMPUTRABAJO_SOURCE_KIND,
    name: POOL_COMPUTRABAJO_SOURCE_NAME,
    externalId: aviso.id,
    url: aviso.url,
    rawRef: null,
  }));
  if (res.ok && res.jobs.length > POOL_EMAIL_MAX_CARDS) {
    return { ok: false, reason: "el email trae demasiados avisos: cola manual" };
  }
  return res;
}

// ---------------------------------------------------------------------------------------------
// Esqueleto para el log
// ---------------------------------------------------------------------------------------------

/** Solo conteos y formas. Nada de texto, links, IDs ni nombres de parámetro fuera de la lista conocida. */
export type PoolEmailSkeleton = {
  htmlChars: number;
  cards: number;
  titleCells: number;
  textCells: number;
  anchors: number;
  trackerLinks: number;
  /** Parámetros conocidos del tracker presentes (solo los nombres); el resto se cuenta en `otherParams`. */
  paramNames: string[];
  otherParams: number;
  /** Etiquetas conocidas con su cantidad; las demás suman en `otro`. */
  tags: Record<string, number>;
  /** Huella (12 hex) de la secuencia de etiquetas: sirve para comparar dos emails sin ver su contenido. */
  shape: string;
};

const KNOWN_TAGS = new Set([
  "html",
  "head",
  "body",
  "meta",
  "title",
  "style",
  "table",
  "thead",
  "tbody",
  "tr",
  "td",
  "th",
  "a",
  "div",
  "span",
  "p",
  "br",
  "hr",
  "img",
  "strong",
  "b",
  "i",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "ul",
  "ol",
  "li",
  "center",
  "font",
]);
const KNOWN_TRACKER_PARAMS = new Set(["url", "ipo", "idu", "isd", "inl", "pos", "utm"]);
const TRACKER_HOST = /^https:\/\/go\.computrabajo\.com\//i;

/**
 * Esqueleto del email para el log, para comparar el primer email real con lo que se esperaba sin guardar
 * su contenido. Pura y acotada: mira a lo sumo `MAX_EMAIL_HTML_CHARS` caracteres.
 */
export function poolEmailSkeleton(html: string): PoolEmailSkeleton {
  const body = html.slice(0, MAX_EMAIL_HTML_CHARS);
  const tags: Record<string, number> = {};
  const sequence: string[] = [];
  for (const m of body.matchAll(/<(\/?)([a-z][a-z0-9]*)/gi)) {
    const name = m[2]!.toLowerCase();
    const known = KNOWN_TAGS.has(name) ? name : "otro";
    const tag = m[1] ? `/${known}` : known;
    sequence.push(tag);
    if (!m[1]) tags[known] = (tags[known] ?? 0) + 1;
  }

  const anchors = tagBlocks(body, "a", { boundary: "space" });
  const cards = anchors.filter((a) => /class="title_oferta"/i.test(a.inner)).length;
  const params = new Set<string>();
  let otherParams = 0;
  let trackerLinks = 0;
  for (const a of anchors) {
    const href = (/href="([^"]+)"/i.exec(a.attrs)?.[1] ?? "").replace(/&amp;/g, "&");
    if (!TRACKER_HOST.test(href)) continue;
    trackerLinks++;
    const q = href.indexOf("?");
    if (q < 0) continue;
    for (const p of href.slice(q + 1).split("&")) {
      const name = p.split("=")[0]!.toLowerCase();
      if (!name) continue;
      if (KNOWN_TRACKER_PARAMS.has(name)) params.add(name);
      else otherParams++;
    }
  }

  return {
    htmlChars: html.length,
    cards,
    titleCells: [...body.matchAll(/class="title_oferta"/gi)].length,
    textCells: [...body.matchAll(/class="texto_oferta"/gi)].length,
    anchors: anchors.length,
    trackerLinks,
    paramNames: [...params].sort(),
    otherParams,
    tags,
    shape: createHash("sha1").update(sequence.join(",")).digest("hex").slice(0, 12),
  };
}

// ---------------------------------------------------------------------------------------------
// Lectura y carga al pool
// ---------------------------------------------------------------------------------------------

export type PoolAlertReadResult =
  | {
      ok: true;
      /** Avisos que quedaron en el pool o ya estaban (nuevos, actualizados, sin cambios y copias). */
      jobsExtracted: number;
      /** Avisos que fallaron al cargar; si hay alguno el email queda con motivo en la cola. */
      errors: number;
      skeleton: PoolEmailSkeleton;
    }
  | { ok: false; reason: string; skeleton: PoolEmailSkeleton | null };

/**
 * Lee un email de una casilla `pool-<carrera>@` y, si la estructura es la conocida, carga cada aviso a
 * `public_jobs` con `role_hints` = la carrera de la casilla. Corre con la conexión de servicio (dueña).
 * Si el parser falla o lanza, no se escribe nada.
 */
export async function readPoolAlertEmail(input: {
  db: Db;
  logger: Logger;
  email: InboundEmailContent;
  career: string;
  now: Date;
}): Promise<PoolAlertReadResult> {
  const { email } = input;
  const skeleton = email.html ? poolEmailSkeleton(email.html) : null;
  let parsed: ParseResult;
  try {
    parsed = parsePoolComputrabajoAlerts(email);
  } catch {
    return { ok: false, reason: "no se pudo leer el contenido", skeleton };
  }
  if (!parsed.ok) return { ok: false, reason: parsed.reason, skeleton };

  let summary;
  try {
    summary = await upsertPoolJobs(parsed.jobs, {
      db: input.db,
      logger: input.logger,
      now: () => input.now,
      roleHints: [input.career],
    });
  } catch (e) {
    input.logger.error(
      { err_name: e instanceof Error ? e.name : "Error" },
      "pool: el lector no pudo cargar los avisos",
    );
    return { ok: false, reason: "no se pudo cargar al pool", skeleton };
  }
  return {
    ok: true,
    jobsExtracted: summary.inserted + summary.updated + summary.unchanged + summary.copies,
    errors: summary.errors + summary.skipped,
    skeleton: skeleton!,
  };
}
