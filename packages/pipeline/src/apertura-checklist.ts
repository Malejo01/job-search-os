/**
 * Checklist de apertura de la beta (R22-05, `/admin/apertura`). Puro: recibe lo que la app leyó del
 * entorno, del disco y de la base (solo hechos: presencia, conteos, nombres de tareas) y devuelve cada
 * ítem como listo o pendiente, con qué hacer y en qué doc está. No lee variables ni la base, no mira el
 * reloj, y nunca recibe el valor de una variable: solo si existe.
 */
import { formatNoticeDate } from "./plan-expiry-notice";

/** Variables clave de la apertura. Solo se mira si existen; nunca su valor ni un pedazo. */
export const APERTURA_VARS = [
  "PRICING_ENABLED",
  "SITE_URL",
  "RESEND_API_KEY",
  "EMAIL_FROM",
  "CONTACT_EMAIL",
  "ADMIN_EMAILS",
  "MCP_USER_ID",
] as const;

export type AperturaInput = {
  now: Date;
  /** Fecha de apertura de la beta (`BETA_OPENS_AT`). */
  opensAt: Date;
  vars: readonly { name: string; present: boolean }[];
  /** Textos de `textos-rediseno.ts`: cuántos hay y cuántos ya aprobó quien define la marca. */
  textos: { total: number; approved: number };
  /** Fichas de Academy; null si no se pudieron leer. */
  academy: { approved: number; total: number } | null;
  /** Imágenes de la mascota que se esperan y cuáles faltan en `public/`. */
  mascota: { total: number; missing: readonly string[] };
  /** Tareas de `model_routing` esperadas (el seed) y las que hay; null si no se pudo leer la base. */
  routing: { expected: readonly string[]; present: readonly string[] } | null;
  /** Si los links de Mercado Pago están cargados (solo presencia). */
  mp: { lista: boolean; tester50: boolean };
  /** Invitaciones sin usar y vigentes; null si no se pudo leer la base. */
  invitations: { unused: number } | null;
};

export type AperturaItemId =
  | "fecha"
  | "variables"
  | "textos"
  | "academy"
  | "mascota"
  | "routing"
  | "mercadopago"
  | "invitaciones";

export type AperturaItem = {
  id: AperturaItemId;
  label: string;
  ok: boolean;
  /** Lo que se encontró, en una línea. */
  detail: string;
  /** Qué hacer; null si está listo. */
  todo: string | null;
  /** Dónde está el detalle (doc o pantalla); null si está listo. */
  doc: string | null;
};

export type AperturaChecklist = { items: AperturaItem[]; pending: number; total: number };

const DAY_MS = 86_400_000;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function ready(id: AperturaItemId, label: string, detail: string): AperturaItem {
  return { id, label, ok: true, detail, todo: null, doc: null };
}

function pendingItem(
  id: AperturaItemId,
  label: string,
  detail: string,
  todo: string,
  doc: string,
): AperturaItem {
  return { id, label, ok: false, detail, todo, doc };
}

export function buildAperturaChecklist(input: AperturaInput): AperturaChecklist {
  const items: AperturaItem[] = [];

  // Fecha de apertura
  if (Number.isNaN(input.opensAt.getTime())) {
    items.push(
      pendingItem(
        "fecha",
        "Fecha de apertura",
        "La fecha de apertura no es válida.",
        "Corregí `BETA_OPENS_AT` en packages/pipeline/src/plan-access.ts.",
        "docs/beta/runbook-apertura.md",
      ),
    );
  } else {
    const left = Math.ceil((input.opensAt.getTime() - input.now.getTime()) / DAY_MS);
    const when = formatNoticeDate(input.opensAt);
    items.push(
      ready(
        "fecha",
        "Fecha de apertura",
        left > 0
          ? `Abre el ${when}: ${left === 1 ? "falta 1 día" : `faltan ${left} días`}.`
          : `La beta ya abrió (${when}).`,
      ),
    );
  }

  // Variables clave: solo nombres
  const missingVars = input.vars.filter((v) => !v.present).map((v) => v.name);
  items.push(
    missingVars.length === 0
      ? ready("variables", "Variables clave", `Cargadas las ${input.vars.length}.`)
      : pendingItem(
          "variables",
          "Variables clave",
          `Faltan ${missingVars.length} de ${input.vars.length}: ${missingVars.join(", ")}.`,
          "Cargalas en Vercel (Settings, Environment Variables) y volvé a desplegar.",
          "docs/beta/runbook-apertura.md (sección 1.2)",
        ),
  );

  // Textos de Ani
  const textosPending = Math.max(0, input.textos.total - input.textos.approved);
  items.push(
    textosPending === 0
      ? ready("textos", "Textos del rediseño", `Los ${input.textos.total} están aprobados.`)
      : pendingItem(
          "textos",
          "Textos del rediseño",
          `${textosPending} de ${input.textos.total} siguen con el valor por defecto.`,
          "Quien define la marca los aprueba desde la app, uno por uno (o propone otro texto). Una aprobación deja de valer si cambia el texto del código.",
          "/admin/textos",
        ),
  );

  // Fichas de Academy
  if (input.academy && input.academy.total > 0 && input.academy.approved === input.academy.total) {
    items.push(
      ready(
        "academy",
        "Fichas de Academy",
        `${input.academy.approved} de ${input.academy.total} aprobadas.`,
      ),
    );
  } else {
    items.push(
      pendingItem(
        "academy",
        "Fichas de Academy",
        input.academy && input.academy.total > 0
          ? `${input.academy.approved} de ${input.academy.total} aprobadas.`
          : "No se encontraron fichas.",
        "Revisá cada ficha y aprobala desde la app (una aprobación deja de valer si cambia el texto de la ficha).",
        "/settings/academy",
      ),
    );
  }

  // Imágenes de la mascota
  const present = input.mascota.total - input.mascota.missing.length;
  items.push(
    input.mascota.missing.length === 0
      ? ready(
          "mascota",
          "Imágenes de la mascota",
          `${present} de ${input.mascota.total} presentes.`,
        )
      : pendingItem(
          "mascota",
          "Imágenes de la mascota",
          `${present} de ${input.mascota.total} presentes; faltan: ${input.mascota.missing.join(", ")}.`,
          "Poné los PNG (1x y 2x) en public/mascota/ y pasá la bandera a true en apps/web/lib/mascota.ts.",
          "docs/MARCA.md",
        ),
  );

  // model_routing
  if (!input.routing) {
    items.push(
      pendingItem(
        "routing",
        "Ruteo de modelos",
        "No se pudo leer model_routing.",
        "Mirá que la base responda y recargá la pantalla.",
        "docs/LLM_COSTOS.md",
      ),
    );
  } else {
    const have = new Set(input.routing.present);
    const missing = input.routing.expected.filter((t) => !have.has(t));
    const found = input.routing.expected.length - missing.length;
    items.push(
      missing.length === 0
        ? ready(
            "routing",
            "Ruteo de modelos",
            `${found} de ${input.routing.expected.length} tareas con modelo asignado.`,
          )
        : pendingItem(
            "routing",
            "Ruteo de modelos",
            `${found} de ${input.routing.expected.length} tareas con modelo; faltan: ${missing.join(", ")}.`,
            "Cargá las filas que faltan en model_routing (las aplica quien administra la base).",
            "docs/LLM_COSTOS.md",
          ),
    );
  }

  // Mercado Pago
  const mpMissing = [
    ...(input.mp.lista ? [] : ["MP_LINK_LISTA"]),
    ...(input.mp.tester50 ? [] : ["MP_LINK_TESTER_50"]),
  ];
  items.push(
    mpMissing.length === 0
      ? ready("mercadopago", "Links de Mercado Pago", "Los dos links están cargados.")
      : pendingItem(
          "mercadopago",
          "Links de Mercado Pago",
          `Falta cargar: ${mpMissing.join(", ")}.`,
          "Generá el link en la cuenta de Mercado Pago, cargalo en Vercel y volvé a desplegar.",
          "docs/beta/runbook-apertura.md (secciones 1.2 y 1.4)",
        ),
  );

  // Invitaciones sin usar
  items.push(
    input.invitations && input.invitations.unused > 0
      ? ready(
          "invitaciones",
          "Invitaciones sin usar",
          `${plural(input.invitations.unused, "vigente", "vigentes")} para enviar o por canjear.`,
        )
      : pendingItem(
          "invitaciones",
          "Invitaciones sin usar",
          input.invitations
            ? "No hay invitaciones vigentes sin usar."
            : "No se pudo leer el conteo de invitaciones.",
          "Elegí a quién invitar y creá las invitaciones desde el panel.",
          "/admin/invitations",
        ),
  );

  const pending = items.filter((i) => !i.ok).length;
  return { items, pending, total: items.length };
}
