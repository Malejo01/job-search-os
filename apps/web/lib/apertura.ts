import { createLogger } from "@job-search-os/adapters";
import { createDb, requireDatabaseUrl } from "@job-search-os/db";
import {
  APERTURA_VARS,
  BETA_OPENS_AT,
  buildAperturaChecklist,
  pricingEnabled,
  TESTER_50_LINK_ENV,
  type AperturaChecklist,
} from "@job-search-os/pipeline";
import { sql } from "drizzle-orm";
import { existsSync } from "node:fs";
import { join } from "node:path";
import routingSeed from "../../../packages/db/seeds/model_routing.json";
import { loadAcademyFichas } from "./academy";
import { canReadAdminData } from "./invitations";
import { MASCOTA_IMAGENES } from "./mascota";
import * as textosRediseno from "./textos-rediseno";

/**
 * Checklist de apertura (R22-05), solo servidor y solo admins. Lee el estado real: variables (solo si
 * existen, nunca el valor), disco (fichas e imágenes) y dos conteos de la base por la conexión de servicio
 * (una consulta por bloque, en paralelo, con `statement_timeout`). Nunca devuelve filas ni valores.
 */

/**
 * Textos de `textos-rediseno.ts` que quien define la marca ya aprobó (nombres de las constantes). Ese
 * archivo trae valores por defecto sin marca de aprobación: al aprobar uno, se agrega acá su nombre.
 * Mientras no esté en esta lista, cuenta como «sigue con el valor por defecto».
 */
export const TEXTOS_REDISENO_APROBADOS: readonly string[] = [];

const log = createLogger({ module: "apertura" });

function mascotaDirs(): string[] {
  return [
    join(process.cwd(), "public", "mascota"),
    join(process.cwd(), "apps", "web", "public", "mascota"),
  ];
}

/** Imágenes de la mascota a las que les falta el PNG 1x o el 2x. */
function missingMascota(): string[] {
  const dir = mascotaDirs().find((d) => existsSync(d));
  return MASCOTA_IMAGENES.filter(
    (name) =>
      !dir || !existsSync(join(dir, `${name}.png`)) || !existsSync(join(dir, `${name}@2x.png`)),
  );
}

async function readDbCounts(): Promise<{
  routing: string[] | null;
  invitations: number | null;
}> {
  let routing: string[] | null = null;
  let invitations: number | null = null;
  const { db, close } = createDb(requireDatabaseUrl({ purpose: "service" }), { max: 2 });
  try {
    await Promise.all([
      db
        .transaction(async (tx) => {
          await tx.execute(sql`set local statement_timeout = '3s'`);
          const rows = (await tx.execute(sql`select task from model_routing`)) as unknown as {
            task: string;
          }[];
          routing = rows.map((r) => r.task);
        })
        .catch((error: unknown) => {
          log.warn(
            { block: "routing", err: error instanceof Error ? error.name : "error" },
            "apertura",
          );
        }),
      db
        .transaction(async (tx) => {
          await tx.execute(sql`set local statement_timeout = '3s'`);
          const rows = (await tx.execute(
            sql`select count(*)::int as n from invitations where used_at is null and expires_at > now()`,
          )) as unknown as { n: number | string }[];
          invitations = Number(rows[0]?.n ?? 0);
        })
        .catch((error: unknown) => {
          log.warn(
            { block: "invitations", err: error instanceof Error ? error.name : "error" },
            "apertura",
          );
        }),
    ]);
  } finally {
    await close();
  }
  return { routing, invitations };
}

export type AperturaResult = { ok: true; checklist: AperturaChecklist } | { ok: false };

export async function getAperturaChecklist(userId: string): Promise<AperturaResult> {
  if (!(await canReadAdminData(userId))) return { ok: false };
  let counts: Awaited<ReturnType<typeof readDbCounts>> = { routing: null, invitations: null };
  try {
    counts = await readDbCounts();
  } catch {
    // Sin base: esos dos ítems quedan pendientes («no se pudo leer»)
  }
  let academy: { approved: number; total: number } | null;
  try {
    const fichas = loadAcademyFichas();
    academy = {
      total: fichas.length,
      approved: fichas.filter((f) => f.estado === "aprobada").length,
    };
  } catch {
    academy = null;
  }
  const env = process.env;
  const present = (name: string) =>
    name === "PRICING_ENABLED" ? pricingEnabled(env) : Boolean(env[name]?.trim());
  const textosNames = Object.keys(textosRediseno);
  return {
    ok: true,
    checklist: buildAperturaChecklist({
      now: new Date(),
      opensAt: BETA_OPENS_AT,
      vars: APERTURA_VARS.map((name) => ({ name, present: present(name) })),
      textos: {
        total: textosNames.length,
        approved: TEXTOS_REDISENO_APROBADOS.filter((n) => textosNames.includes(n)).length,
      },
      academy,
      mascota: { total: MASCOTA_IMAGENES.length, missing: missingMascota() },
      routing: counts.routing
        ? { expected: routingSeed.map((r) => r.task), present: counts.routing }
        : null,
      mp: { lista: present("MP_LINK_LISTA"), tester50: present(TESTER_50_LINK_ENV) },
      invitations: counts.invitations === null ? null : { unused: counts.invitations },
    }),
  };
}
