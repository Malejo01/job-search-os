import { createLogger } from "@job-search-os/adapters";
import { createDb, requireDatabaseUrl } from "@job-search-os/db";
import {
  APERTURA_VARS,
  BETA_OPENS_AT,
  buildAperturaChecklist,
  contarTextosAprobados,
  COVERAGE_ENTRY_THRESHOLD,
  COVERAGE_TOMABLE_THRESHOLD,
  isRoleKey,
  formatNoticeDate,
  pricingEnabled,
  TESTER_50_LINK_ENV,
  voiceServerMode,
  type AperturaItem,
  type RevisionDeTexto,
} from "@job-search-os/pipeline";
import { sql } from "drizzle-orm";
import { existsSync } from "node:fs";
import { join } from "node:path";
import routingSeed from "../../../packages/db/seeds/model_routing.json";
import { loadAcademyFichas, publishedFichas } from "./academy";
import { careerLabel } from "./career-market";
import { getCobertura } from "./cobertura";
import { canReadAdminData } from "./invitations";
import { MASCOTA_IMAGENES, mascotaArchivos } from "./mascota";
import { textosRediseno } from "./textos-aprobacion";
import { COBERTURA_TEXTOS as T } from "./textos-rediseno";
import { TERMS_VERSION } from "./terms";

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
  /** Proveedor y modelo por tarea (R28-03): solo nombres de tareas y modelos, nada secreto. */
  routingRows: RutaDeModelo[] | null;
  invitations: number | null;
  /** Lo último que se dijo de cada texto del rediseño (R26-02): clave → estado y huella. */
  textReviews: Map<string, RevisionDeTexto> | null;
  /** Fichas de Academy cuya revisión vigente es una aprobación (R26-01): slug → huella. */
  academyApproved: Map<string, string> | null;
  /** ¿Existe `feedback_reports` (R29-02)? null si no se pudo leer. */
  informesTabla: boolean | null;
}> {
  let informesTabla: boolean | null = null;
  let routing: string[] | null = null;
  let routingRows: RutaDeModelo[] | null = null;
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
            sql`select (to_regclass('public.feedback_reports') is not null) as ok`,
          )) as unknown as { ok: boolean }[];
          informesTabla = rows[0]?.ok === true;
        })
        .catch((error: unknown) => {
          log.warn(
            { block: "feedback_reports", err: error instanceof Error ? error.name : "error" },
            "apertura",
          );
        }),
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
          const rows = (await tx.execute(
            sql`select task, provider, model from model_routing`,
          )) as unknown as RutaDeModelo[];
          routingRows = rows.map((r) => ({ task: r.task, provider: r.provider, model: r.model }));
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
  return { routing, routingRows, invitations, textReviews, academyApproved, informesTabla };
}

/** Un ítem de la checklist; los de R28-03 llevan ids propios, por eso `id` es un texto. */
export type AperturaItemWeb = Omit<AperturaItem, "id"> & { id: string };
export type AperturaChecklistWeb = { items: AperturaItemWeb[]; pending: number; total: number };
export type AperturaResult = { ok: true; checklist: AperturaChecklistWeb } | { ok: false };

export type RutaDeModelo = { task: string; provider: string; model: string };

/**
 * Versión de los términos que había antes del PR legal #552. El código no puede saber si el #552 está
 * mergeado: si la versión vigente sigue siendo esta, el ítem queda pendiente; si cambió, se da por traído
 * (es una inferencia, y el detalle lo dice).
 */
export const TERMS_VERSION_ANTES_DEL_552 = "2026-11-02";

/**
 * La fecha de `BETA_OPENS_AT` es provisoria hasta que quien administra el producto la confirme. Cuando la fije, cambiar a `true`
 * en el mismo commit que cambia la fecha en `packages/pipeline/src/plan-access.ts`.
 */
export const BETA_FECHA_DEFINITIVA = false;

export type AperturaExtrasInput = {
  now: Date;
  opensAt: Date;
  fechaDefinitiva: boolean;
  termsVersion: string;
  /** Solo se lee `VOICE_SERVER_TRANSCRIBE`, y solo para saber el modo, nunca se muestra. */
  env: Record<string, string | undefined>;
  /** Tareas del seed cuyo proveedor es Anthropic, con el modelo que debe tener cada una. */
  routingEsperado: readonly RutaDeModelo[];
  /** Lo que hay en la base; null si no se pudo leer. */
  routingActual: readonly RutaDeModelo[] | null;
  /** ¿Existen las tablas de los informes de revisión (R29, migración 0084)? Ausente o null = no se pudo leer. */
  informesTabla?: boolean | null;
  /**
   * Cobertura del pool carrera por carrera (R32-02). Ausente o null = no se pudo leer. Solo agregados:
   * etiqueta de la carrera, tomables, para quien empieza y el semáforo ya calculado por el pipeline.
   */
  cobertura?: readonly CoberturaCarrera[] | null;
};

export type CoberturaCarrera = {
  label: string;
  tomables: number;
  paraEmpezar: number;
  semaforo: "verde" | "amarillo" | "rojo";
};

/** Ítem «Cobertura de las carreras de la beta»: listo solo si todas están en verde. Puro. */
export function coberturaItem(
  cobertura: readonly CoberturaCarrera[] | null | undefined,
): AperturaItemWeb {
  const label = T.apertura.label;
  if (!cobertura || cobertura.length === 0) {
    return {
      id: "cobertura",
      label,
      ok: false,
      detail: T.apertura.noLeyo,
      todo: "Mirá que la base responda y recargá la pantalla.",
      doc: "/admin/cobertura",
    };
  }
  const sinVerde = cobertura.filter((c) => c.semaforo !== "verde");
  if (sinVerde.length === 0) {
    return {
      id: "cobertura",
      label,
      ok: true,
      detail: T.apertura.todas.replace("{total}", String(cobertura.length)),
      todo: null,
      doc: null,
    };
  }
  const faltan = sinVerde
    .map(
      (c) =>
        `${c.label} (${c.tomables} de ${COVERAGE_TOMABLE_THRESHOLD} tomables, ${c.paraEmpezar} de ${COVERAGE_ENTRY_THRESHOLD} para quien empieza)`,
    )
    .join("; ");
  return {
    id: "cobertura",
    label,
    ok: false,
    detail: T.apertura.algunas
      .replace("{verdes}", String(cobertura.length - sinVerde.length))
      .replace("{total}", String(cobertura.length))
      .replace("{faltan}", faltan),
    todo: T.apertura.todo,
    doc: "/admin/cobertura",
  };
}

/**
 * Ítems de apertura que se suman a los de `buildAperturaChecklist` (R28-03). Puro: sin I/O ni reloj.
 * Cada uno lee un hecho (modo de la voz, versión, filas de ruteo) y nunca devuelve el valor de una variable.
 */
export function buildAperturaExtras(input: AperturaExtrasInput): AperturaItemWeb[] {
  const items: AperturaItemWeb[] = [];

  // Términos (PR legal #552)
  const trajoElLegal = input.termsVersion > TERMS_VERSION_ANTES_DEL_552;
  items.push(
    trajoElLegal
      ? {
          id: "terminos",
          label: "Términos y privacidad (PR legal #552)",
          ok: true,
          detail: `La versión vigente de los términos es ${input.termsVersion}, posterior a ${TERMS_VERSION_ANTES_DEL_552}: el cambio legal ya está en el código.`,
          todo: null,
          doc: null,
        }
      : {
          id: "terminos",
          label: "Términos y privacidad (PR legal #552)",
          ok: false,
          detail: `La versión de los términos en el código sigue en ${input.termsVersion}: pendiente confirmar que el PR legal #552 esté mergeado.`,
          todo: "Quien administra el repositorio revisa y mergea el PR legal #552 (trae la versión nueva de los términos y el párrafo de voz de la política de privacidad). Después de mergear, esta fila se pone en Listo sola.",
          doc: "docs/beta/pasos-manuales-r25.md (sección 4)",
        },
  );

  // Voz en el servidor
  const modo = voiceServerMode(input.env);
  items.push(
    modo === "all"
      ? {
          id: "voz",
          label: "Voz en el servidor",
          ok: true,
          detail: "VOICE_SERVER_TRANSCRIBE está en «all»: todas las personas pueden dictar.",
          todo: null,
          doc: null,
        }
      : {
          id: "voz",
          label: "Voz en el servidor",
          ok: false,
          detail:
            modo === "testers"
              ? "VOICE_SERVER_TRANSCRIBE está en «testers»: dictan solo los testers."
              : "VOICE_SERVER_TRANSCRIBE está apagada: Opera, Brave y Firefox no tienen dictado.",
          todo: "Con la política de privacidad publicada (#552), poné VOICE_SERVER_TRANSCRIBE=all en Vercel y volvé a desplegar.",
          doc: "docs/beta/pasos-manuales-r25.md (secciones 3 y 4)",
        },
  );

  // Ruteo a Claude (sql/ruteo-s4.sql)
  if (!input.routingActual) {
    items.push({
      id: "ruteo_claude",
      label: "Ruteo a Claude",
      ok: false,
      detail: "No se pudo leer model_routing.",
      todo: "Mirá que la base responda y recargá la pantalla.",
      doc: "docs/beta/pasos-manuales-s4.md (sección 1.4)",
    });
  } else {
    const actual = new Map(input.routingActual.map((r) => [r.task, r]));
    const distintas = input.routingEsperado
      .filter((e) => {
        const a = actual.get(e.task);
        return !a || a.provider !== e.provider || a.model !== e.model;
      })
      .map((e) => e.task);
    const total = input.routingEsperado.length;
    items.push(
      distintas.length === 0
        ? {
            id: "ruteo_claude",
            label: "Ruteo a Claude",
            ok: true,
            detail: `Las ${total} tareas con Claude de principal tienen el modelo del seed.`,
            todo: null,
            doc: null,
          }
        : {
            id: "ruteo_claude",
            label: "Ruteo a Claude",
            ok: false,
            detail: `${total - distintas.length} de ${total} tareas con el modelo del seed; difieren: ${distintas.join(", ")}.`,
            todo: "Quien administra la base corre packages/db/sql/ruteo-s4.sql: primero con --ensayo y después sin él.",
            doc: "docs/beta/pasos-manuales-s4.md (sección 1.4)",
          },
    );
  }

  // Informes de revisión de las testers (R29): migración 0084 y funciones admin en la base
  items.push(
    input.informesTabla === true
      ? {
          id: "informes_revision",
          label: "Informes de revisión (/admin/informes)",
          ok: true,
          detail:
            "Las tablas de los informes están en la base: las testers pueden enviarlos y se leen en /admin/informes.",
          todo: null,
          doc: null,
        }
      : {
          id: "informes_revision",
          label: "Informes de revisión (/admin/informes)",
          ok: false,
          detail:
            input.informesTabla === false
              ? "Las tablas de los informes todavía no están en la base."
              : "No se pudo leer si las tablas de los informes están en la base.",
          todo: "Quien administra la base aplica la migración 0084 y las políticas RLS 0069 y 0070 (y después, opcional, VOICE_TESTER_DAILY_MINUTES en Vercel). Los pasos están en el documento indicado.",
          doc: "docs/beta/pasos-manuales-r29.md",
        },
  );

  // Cobertura del pool por carrera (R32-02): informa; abrir una carrera lo decide el responsable
  items.push(coberturaItem(input.cobertura));

  // Fecha definitiva
  if (Number.isNaN(input.opensAt.getTime())) {
    items.push({
      id: "fecha_definitiva",
      label: "Fecha definitiva de apertura",
      ok: false,
      detail: "BETA_OPENS_AT no es una fecha válida.",
      todo: "Corregí BETA_OPENS_AT en packages/pipeline/src/plan-access.ts.",
      doc: "docs/beta/runbook-apertura.md",
    });
  } else {
    const cuando = formatNoticeDate(input.opensAt);
    items.push(
      input.fechaDefinitiva
        ? {
            id: "fecha_definitiva",
            label: "Fecha definitiva de apertura",
            ok: true,
            detail: `La fecha de apertura está confirmada: ${cuando}.`,
            todo: null,
            doc: null,
          }
        : {
            id: "fecha_definitiva",
            label: "Fecha definitiva de apertura",
            ok: false,
            detail: `La fecha del código (${cuando}) es provisoria.`,
            todo: "Elegí el día, cambiá BETA_OPENS_AT en packages/pipeline/src/plan-access.ts y poné BETA_FECHA_DEFINITIVA en true en apps/web/lib/apertura.ts; los textos que dicen «a principios de diciembre» se ajustan al mismo tiempo.",
            doc: "docs/beta/runbook-apertura.md",
          },
    );
  }

  return items;
}

/** Las tareas que toca `packages/db/sql/ruteo-s4.sql` (solo nombres: el modelo sale del seed). */
export const TAREAS_RUTEO_S4 = [
  "evaluate_job",
  "extract_skills",
  "parse_email_fallback",
  "cv_interview",
  "extract_cv_profile",
  "cv_write",
  "cv_review",
  "cv_coach_turn",
  "extract_job_from_image",
] as const;

/** Lo que debe haber en la base para esas tareas: proveedor y modelo del seed. */
export function routingEsperadoClaude(
  seed: readonly { task: string; provider: string; model: string }[],
): RutaDeModelo[] {
  const tareas: readonly string[] = TAREAS_RUTEO_S4;
  return seed
    .filter((r) => tareas.includes(r.task))
    .map((r) => ({ task: r.task, provider: r.provider, model: r.model }));
}

export async function getAperturaChecklist(userId: string): Promise<AperturaResult> {
  if (!(await canReadAdminData(userId))) return { ok: false };
  let counts: Awaited<ReturnType<typeof readDbCounts>> = {
    routing: null,
    routingRows: null,
    invitations: null,
    textReviews: null,
    academyApproved: null,
    informesTabla: null,
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
  const now = new Date();
  const base = buildAperturaChecklist({
    now,
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
  });
  // R32-02: la cobertura sale de las mismas reglas que /admin/cobertura; sin lectura queda pendiente
  const cobertura = await getCobertura(userId);
  const extras = buildAperturaExtras({
    cobertura: cobertura.ok
      ? cobertura.rows.map((r) => ({
          label: isRoleKey(r.role) ? careerLabel(r.role) : r.role,
          tomables: r.tomables,
          paraEmpezar: r.paraEmpezar,
          semaforo: r.semaforo,
        }))
      : null,
    now,
    opensAt: BETA_OPENS_AT,
    fechaDefinitiva: BETA_FECHA_DEFINITIVA,
    termsVersion: TERMS_VERSION,
    env,
    routingEsperado: routingEsperadoClaude(routingSeed),
    routingActual: counts.routingRows,
    informesTabla: counts.informesTabla,
  });
  const items: AperturaItemWeb[] = [...base.items, ...extras];
  const pending = items.filter((i) => !i.ok).length;
  return { ok: true, checklist: { items, pending, total: items.length } };
}
