import { createDemoLlm, type LlmClient } from "@job-search-os/adapters";
import { cvDeclined, parseCoachRange } from "@job-search-os/pipeline";
import type { CvCoachFixture } from "./golden";

/**
 * Modelo **simulado** del coach (R12-13): código que imita lo que haría `cv_review` y `cv_coach_turn` con una
 * fixture, sin red y sin gasto. Sirve para grabar transcripciones de prueba (`origen: simulada`) y para
 * ejercitar el harness entero en los tests. No mide al modelo: mide el circuito y las métricas.
 *
 * - `cv_review`: propone los problemas esperados que no son de datos, más uno con un ítem que no existe (el
 *   código lo tiene que descartar).
 * - `cv_coach_turn`: fechas con `parseCoachRange`; stack si el problema es de stack; si no, la respuesta como
 *   viñeta del ítem en foco, o como logro del ítem que nombra (para las skills). Sin pregunta propia: el
 *   código cae a la plantilla.
 * - `cv_write`: el de demo (devuelve lo que dijo la persona).
 */
const DATA_TYPES = new Set(["brecha_con_puesto", "skill_pedida_sin_evidencia"]);
const SECTION_OF = {
  trabajo: "experience",
  proyecto: "projects",
  educacion: "education",
  certificacion: "education",
} as const;

const sentence = (s: string): string => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= 220 ? t : `${t.slice(0, 217).trimEnd()}…`;
};

function reviewOutput(f: CvCoachFixture): Record<string, unknown> {
  const issues: Record<string, unknown>[] = [];
  for (const e of f.problemas_esperados) {
    if (DATA_TYPES.has(e.tipo) || "skill" in e) continue;
    const item = e.item ? f.lectura.items.find((i) => i.clave === e.item) : undefined;
    const section = item
      ? SECTION_OF[item.kind]
      : e.tipo === "resumen_generico"
        ? "summary"
        : "experience";
    issues.push({
      type: e.tipo,
      ref: {
        section,
        itemId: item?.id ?? null,
        field: e.tipo === "orden_poco_relevante" ? "order" : null,
      },
      quote: item?.bullets[0] ?? null,
      skillSlug: null,
      severity: "media",
    });
  }
  // Un problema con un ítem que no existe: el código lo descarta
  issues.push({
    type: "tarea_vaga",
    ref: {
      section: "experience",
      itemId: "00000000-0000-4000-8000-0000000dead0",
      field: "bullets",
    },
    quote: null,
    skillSlug: null,
    severity: "alta",
  });
  return { issues: issues.slice(0, 15) };
}

type Patch = {
  title: string | null;
  organization: string | null;
  startMonth: string | null;
  endMonth: string | null;
  isCurrent: boolean | null;
  bullets: string[];
  link: string | null;
  stack: string[];
};
const emptyPatch = (): Patch => ({
  title: null,
  organization: null,
  startMonth: null,
  endMonth: null,
  isCurrent: null,
  bullets: [],
  link: null,
  stack: [],
});

function turnOutput(
  f: CvCoachFixture,
  vars: Record<string, string | number | boolean>,
): Record<string, unknown> {
  const focus = String(vars.focus ?? "");
  const message =
    /<<<MENSAJE>>>\n([\s\S]*)\n<<<FIN MENSAJE>>>/.exec(String(vars.message ?? ""))?.[1] ?? "";
  const type = /tipo: ([a-z_]+)/.exec(focus)?.[1] ?? "";
  const itemId = /ítem: ([0-9a-f-]{36})/.exec(focus)?.[1] ?? null;
  const out = {
    patch: emptyPatch(),
    extras: [] as Record<string, unknown>[],
    declined: false,
    nextQuestion: null,
  };
  if (cvDeclined(message)) return { ...out, declined: true };
  if (type === "fecha_faltante") {
    const r = parseCoachRange(message);
    if (r)
      out.patch = {
        ...out.patch,
        startMonth: r.startMonth,
        endMonth: r.endMonth,
        isCurrent: r.isCurrent,
      };
    return out;
  }
  if (type === "proyecto_sin_stack_o_link") {
    const stack = message
      .replace(/[.]$/, "")
      .split(/,| y /)
      .map((s) => s.replace(/^(lo armé con|usé)\s+/i, "").trim())
      .filter((s) => s.length > 1 && s.length <= 60 && !/link/i.test(s));
    out.patch = { ...out.patch, stack: stack.slice(0, 12) };
    return out;
  }
  if (DATA_TYPES.has(type) || itemId === null) {
    // Una skill: se ubica en el ítem que la persona nombra; si no nombra ninguno, queda sin ítem
    const named = f.lectura.items.find(
      (i) => message.includes(i.organization) || message.includes(i.title),
    );
    out.extras = [
      {
        kind: "logro",
        text: sentence(message),
        ref: named ? { section: SECTION_OF[named.kind], itemId: named.id, field: "bullets" } : null,
      },
    ];
    return out;
  }
  out.patch = { ...out.patch, bullets: [sentence(message)] };
  return out;
}

export function simulatedLlm(f: CvCoachFixture): LlmClient {
  const demo = createDemoLlm();
  return {
    async generateStructured(task, schema, vars, ctx = {}) {
      if (task !== "cv_review" && task !== "cv_coach_turn")
        return demo.generateStructured(task, schema, vars, ctx);
      const object = task === "cv_review" ? reviewOutput(f) : turnOutput(f, vars);
      const parsed = schema.safeParse(object);
      if (!parsed.success) {
        return {
          ok: false,
          error: { kind: "generation_failed", task, detail: "simulada: no cumple el esquema" },
        };
      }
      return {
        ok: true,
        value: {
          object: parsed.data,
          model: "simulado",
          provider: "simulado",
          promptVersion: ctx.promptVersion ?? `${task}@v1`,
          usage: { inputTokens: 0, outputTokens: 0, reasoningTokens: 0 },
          costUsd: 0,
          latencyMs: 0,
          usedFallback: false,
        },
      };
    },
  };
}
