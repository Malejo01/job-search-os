import { createLogger } from "@job-search-os/adapters";
import { createDb, requireDatabaseUrl } from "@job-search-os/db";
import {
  APERTURA_VARS,
  BETA_OPENS_AT,
  buildAperturaChecklist,
  contarTextosAprobados,
  pricingEnabled,
  TESTER_50_LINK_ENV,
  type AperturaChecklist,
  type RevisionDeTexto,
} from "@job-search-os/pipeline";
import { sql } from "drizzle-orm";
import { existsSync } from "node:fs";
import { join } from "node:path";
import routingSeed from "../../../packages/db/seeds/model_routing.json";
import { loadAcademyFichas, publishedFichas } from "./academy";
import { canReadAdminData } from "./invitations";
import { MASCOTA_IMAGENES, mascotaArchivos } from "./mascota";
import { textosRediseno } from "./textos-aprobacion";

/**
 * Checklist de apertura (R22-05), solo servidor y solo admins. Lee el estado real: variables (solo si
 * existen, nunca el valor), disco (fichas e imágenes) y dos conteos de la base por la conexión de servicio
 * (una consulta por bloque, en paralelo, con `statement_timeout`). Nunca devuelve filas ni valores.
 */

// R26-02: los textos del rediseño y las fichas de Academy se cuentan como aprobados desde la base (`text_reviews`,
// `academy_reviews`), con la huella de hoy: si el texto del código cambió, la aprobación vieja no cuenta. Ya no
// hay una lista a mano (era `TEXTOS_REDISENO_APROBADOS`).

const log = createLogger({ module: "apertura" });

function mascotaDirs(): string[] {
  return [
    join(process.cwd(), "public", "mascota"),
    join(process.cwd(), "apps", "web", "public", "mascota"),
  ];
}

/** Imágenes de la mascota (poses y caras) a las que les falta algún archivo (WebP o PNG). */
function missingMascota(): string[] {
  const dir = mascotaDirs().find((d) => existsSync(d));
  return MASCOTA_IMAGENES.filter(
    (name) => !dir || !mascotaArchivos(name).every((f) => existsSync(join(dir, f))),
  );
}

async function readDbCounts(): Promise<{
  routing: string[] | null;
  invitations: number | null;
  /** Lo último que se dijo de cada texto del rediseño (R26-02): clave → estado y huella. */
  textReviews: Map<string, RevisionDeTexto> | null;
  /** Fichas de Academy cuya revisión vigente es una aprobación (R26-01): slug → huella. */
  academyApproved: Map<string, string> | null;
}> {
  let routing: string[] | null = null;
  let invitations: number | null = null;
  let textReviews: Map<string, RevisionDeTexto> | null = null;
  let academyApproved: Map<string, string> | null = null;
  const { db, close } = createDb(requireDatabaseUrl({ purpose: "service" }), { max: 2 });
  try {
    await Promise.all([
      db
        .transaction(async (tx) => {
          await tx.execute(sql`set local statement_timeout = '3s'`);
          const rows = (await tx.execute(
            sql`select distinct on (text_key) text_key, default_hash, status
                  from text_reviews order by text_key, created_at desc, id desc`,
          )) as unknown as { text_key: string; default_hash: string; status: string }[];
          textReviews = new Map(
            rows.map((r) => [
              r.text_key,
              {
                estado: r.status === "aprobada" ? "aprobada" : "propuesta",
                huella: r.default_hash,
              },
            ]),
          );
        })
        .catch((error: unknown) => {
          log.warn(
            { block: "text_reviews", err: error instanceof Error ? error.name : "error" },
            "apertura",
          );
        }),
      db
        .transaction(async (tx) => {
          await tx.execute(sql`set local statement_timeout = '3s'`);
          const rows = (await tx.execute(
            sql`select slug, content_hash from (
                  select distinct on (slug) slug, content_hash, status
                    from academy_reviews order by slug, created_at desc, id desc
                ) l where status = 'aprobada'`,
          )) as unknown as { slug: string; content_hash: string }[];
          academyApproved = new Map(rows.map((r) => [r.slug, r.content_hash]));
        })
        .catch((error: unknown) => {
          log.warn(
            { block: "academy_reviews", err: error instanceof Error ? error.name : "error" },
            "apertura",
          );
        }),
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
  return { routing, invitations, textReviews, academyApproved };
}

export type AperturaResult = { ok: true; checklist: AperturaChecklist } | { ok: false };

export async function getAperturaChecklist(userId: string): Promise<AperturaResult> {
  if (!(await canReadAdminData(userId))) return { ok: false };
  let counts: Awaited<ReturnType<typeof readDbCounts>> = {
    routing: null,
    invitations: null,
    textReviews: null,
    academyApproved: null,
  };
  try {
    counts = await readDbCounts();
  } catch {
    // Sin base: esos ítems quedan pendientes («no se pudo leer»); las aprobaciones, en cero (falla cerrado)
  }
  let academy: { approved: number; total: number } | null;
  try {
    const fichas = publishedFichas(loadAcademyFichas(), counts.academyApproved ?? new Map());
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
  const textos = contarTextosAprobados(textosRediseno(), counts.textReviews ?? new Map());
  return {
    ok: true,
    checklist: buildAperturaChecklist({
      now: new Date(),
      opensAt: BETA_OPENS_AT,
      vars: APERTURA_VARS.map((name) => ({ name, present: present(name) })),
      textos: { total: textos.total, approved: textos.aprobados },
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
