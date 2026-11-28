import { z } from "zod";
import type { LlmWire } from "../evaluator/wire";
import { err, ok, type Result } from "../result";
import {
  CONTRATACIONES,
  IDIOMAS_AVISO,
  JORNADAS,
  MODALIDADES,
  NIVELES_INGLES,
  PERIODOS_SALARIO,
  REQUIREMENT_CATEGORIES,
  REQUIREMENT_LEVELS,
  parseJobCard,
  type JobCard,
} from "./schema";
import { verifyJobCardDetailed, type VerifyOutcome } from "./verify";

/**
 * Borde del LLM (mismo criterio que `evaluator/wire.ts`): el esquema que viaja al proveedor repite la forma de
 * `JobCardSchema` sin límites de largo ni de rango ni la clave reservada `contradictorio` (la decide el código);
 * lo que vuelve se recorta con una función pura y recién después corre la validación estricta y la verificación.
 */
const str = z.string();
const cita = z.string();
const nullableNum = z.number().nullable();

export const jobCardWire: LlmWire = {
  schema: z.object({
    resumen: z.object({ texto: str, citas: z.array(cita) }).nullable(),
    tareas: z.array(z.object({ texto: str, cita })),
    requisitos: z.array(
      z.object({
        texto: str,
        nivel: z.enum(REQUIREMENT_LEVELS),
        categoria: z.enum(REQUIREMENT_CATEGORIES),
        anos: nullableNum,
        idioma: str.nullable(),
        cita,
      }),
    ),
    condiciones: z.object({
      modalidad: z.object({ valor: z.enum(MODALIDADES), cita }).nullable(),
      desdeDonde: z
        .object({
          alcance: z.enum(["cualquier_pais", "paises", "ciudad"]),
          lugares: z.array(str),
          cita,
        })
        .nullable(),
      salario: z
        .object({
          texto: str,
          minimo: nullableNum,
          maximo: nullableNum,
          moneda: str.nullable(),
          periodo: z.enum(PERIODOS_SALARIO).nullable(),
          cita,
        })
        .nullable(),
      experiencia: z.object({ texto: str, anos: nullableNum, cita }).nullable(),
      ingles: z
        .object({ nivel: z.enum(NIVELES_INGLES), nivelTexto: str.nullable(), cita })
        .nullable(),
      jornada: z.object({ valor: z.enum(JORNADAS), cita }).nullable(),
      contratacion: z.object({ valor: z.enum(CONTRATACIONES), cita }).nullable(),
    }),
    habilidades: z.array(z.object({ nombre: str, cita })),
    area: z.object({ valor: str, cita }).nullable(),
    idioma: z.object({ valor: z.enum(IDIOMAS_AVISO), cita: cita.nullable() }),
  }),
  normalize: normalizeJobCardRaw,
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const LIMITS = { cita: 600, texto: 400, nombre: 80, lugar: 80, short: 60, resumen: 700 } as const;
const LIST_MAX = 40;

const clip = (v: unknown, max: number): unknown =>
  typeof v === "string" ? v.trim().slice(0, max) : v;

function mapRec(v: unknown, fn: (o: Record<string, unknown>) => Record<string, unknown>): unknown {
  return isRecord(v) ? fn(v) : v;
}

function mapList(v: unknown, fn: (o: Record<string, unknown>) => Record<string, unknown>): unknown {
  if (!Array.isArray(v)) return v;
  return v.slice(0, LIST_MAX).map((x) => mapRec(x, fn));
}

/** Recorta lo que excede los límites y deja pasar lo demás: lo que no se puede normalizar falla en el esquema estricto. */
export function normalizeJobCardRaw(raw: unknown): unknown {
  if (!isRecord(raw)) return raw;
  const c = isRecord(raw.condiciones) ? raw.condiciones : null;
  const withCita = (o: Record<string, unknown>) => ({ ...o, cita: clip(o.cita, LIMITS.cita) });
  return {
    ...raw,
    resumen: mapRec(raw.resumen, (o) => ({
      ...o,
      texto: clip(o.texto, LIMITS.resumen),
      citas: Array.isArray(o.citas)
        ? o.citas.slice(0, 5).map((x) => clip(x, LIMITS.cita))
        : o.citas,
    })),
    tareas: mapList(raw.tareas, (o) => ({ ...withCita(o), texto: clip(o.texto, LIMITS.texto) })),
    requisitos: mapList(raw.requisitos, (o) => ({
      ...withCita(o),
      texto: clip(o.texto, LIMITS.texto),
      idioma: clip(o.idioma, LIMITS.short),
    })),
    condiciones: c
      ? {
          ...c,
          modalidad: mapRec(c.modalidad, withCita),
          desdeDonde: mapRec(c.desdeDonde, (o) => ({
            ...withCita(o),
            lugares: Array.isArray(o.lugares)
              ? o.lugares.slice(0, LIST_MAX).map((x) => clip(x, LIMITS.lugar))
              : o.lugares,
          })),
          salario: mapRec(c.salario, (o) => ({
            ...withCita(o),
            texto: clip(o.texto, LIMITS.texto),
            moneda: clip(o.moneda, 10),
          })),
          experiencia: mapRec(c.experiencia, (o) => ({
            ...withCita(o),
            texto: clip(o.texto, LIMITS.texto),
          })),
          ingles: mapRec(c.ingles, (o) => ({
            ...withCita(o),
            nivelTexto: clip(o.nivelTexto, LIMITS.short),
          })),
          jornada: mapRec(c.jornada, withCita),
          contratacion: mapRec(c.contratacion, withCita),
        }
      : raw.condiciones,
    habilidades: mapList(raw.habilidades, (o) => ({
      ...withCita(o),
      nombre: clip(o.nombre, LIMITS.nombre),
    })),
    area: mapRec(raw.area, (o) => ({ ...withCita(o), valor: clip(o.valor, LIMITS.nombre) })),
    idioma: mapRec(raw.idioma, (o) => ({ ...o, cita: clip(o.cita, LIMITS.cita) })),
  };
}

export type JobCardFinalizeError = "ficha_json_invalido" | "ficha_esquema_invalido";

/**
 * De la salida del modelo a la ficha que se guarda: esquema estricto (falla cerrado) y verificación contra el texto
 * que viajó al modelo (`prepareJobCardText`). Nunca lanza.
 */
export function finalizeJobCard(
  raw: unknown,
  sentText: string,
): Result<VerifyOutcome, JobCardFinalizeError> {
  const parsed = parseJobCard(normalizeJobCardRaw(raw));
  if (!parsed.ok) return err(parsed.error as JobCardFinalizeError);
  return ok(verifyJobCardDetailed(parsed.value, sentText));
}

/** ¿La ficha verificada trae algo que mostrar? Una ficha vacía no se guarda como `lista`. */
export function jobCardHasContent(card: JobCard): boolean {
  const c = card.condiciones;
  return (
    card.resumen !== null ||
    card.tareas.length > 0 ||
    card.requisitos.length > 0 ||
    card.habilidades.length > 0 ||
    card.area !== null ||
    Object.values(c).some((x) => x !== null)
  );
}
