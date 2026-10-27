import { COUNTRY_OPTIONS } from "@job-search-os/pipeline";
import type { LanguageModel } from "ai";
import {
  ASSISTANT_TASK,
  type AgentStreamFn,
  type AgentStreamPart,
  type StreamAgentDeps,
} from "./agent";
import { DEMO_MODEL } from "./demo";
import { staticRouteSource } from "./router";
import type { CallSink, ProviderRegistry } from "./types";

/**
 * Asistente sin red (AG-1): un fake guionado para tests y el modo demo (`LLM_DEMO=1`, previews y
 * e2e). Igual que `demo.ts`: model = "fake" en llm_calls, costo 0 y texto que empieza con «DEMO:».
 * Las reglas son deliberadamente tontas y deterministas: alcanzan para ver el flujo de propuesta y
 * confirmación entero, no reemplazan al modelo.
 */

export const DEMO_AGENT_MODEL = DEMO_MODEL;

/** Guion fijo: cada llamada consume el siguiente paso. Sin pasos, termina sin texto. */
export function createScriptedStreamFn(
  script: AgentStreamPart[][] | ((args: Parameters<AgentStreamFn>[0]) => AgentStreamPart[]),
): AgentStreamFn {
  let i = 0;
  return async function* (args) {
    const parts = typeof script === "function" ? script(args) : (script[i++] ?? [finishPart(0, 0)]);
    for (const part of parts) yield part;
  };
}

const finishPart = (inputTokens: number, outputTokens: number): AgentStreamPart => ({
  type: "finish",
  usage: { inputTokens, outputTokens },
});

const DEMO_USAGE = finishPart(50, 20);

const normalize = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();

/** Nombre de país (de la lista del buscador) → código ISO; null si no está. */
function countryCode(name: string): string | null {
  const wanted = normalize(name);
  return COUNTRY_OPTIONS.find((c) => normalize(c.label) === wanted)?.code ?? null;
}

const COUNTRY_RE = /(?:me mud[ée] a|vivo en|cambi[áa] mi pa[íi]s a)\s+(\p{L}+(?:\s\p{L}+)?)/iu;
const YEARS_RE = /tengo (\d{1,2}) años de experiencia/iu;

type Change = { field: string; value: string; source: { from: "message"; quote: string } };

/** Cambio del perfil reconocible en el mensaje, con la cita EXACTA que lo fundamenta. */
function demoProfileChange(message: string): Change | null {
  const country = COUNTRY_RE.exec(message);
  if (country) {
    // Probar con dos palabras («Costa Rica») y después con una («Uruguay el mes pasado» → Uruguay)
    const words = country[1]!.split(/\s/);
    for (const n of [words.length, 1]) {
      const name = words.slice(0, n).join(" ");
      const code = countryCode(name);
      if (code) {
        const quote = country[0].slice(0, country[0].length - country[1]!.length) + name;
        return { field: "country", value: code, source: { from: "message", quote } };
      }
    }
  }
  const years = YEARS_RE.exec(message);
  if (years) {
    return {
      field: "yearsTotal",
      value: years[1]!,
      source: { from: "message", quote: years[0] },
    };
  }
  return null;
}

const APPLIED_RE = /(?:ya )?me postul[ée]/iu;
/** «no me postulé», «todavía no me postulé»: no es un hecho, no se propone nada. */
const NOT_APPLIED_RE = /\b(?:no|todav[íi]a)\b[^.?!]{0,20}me postul/iu;
// El título va hasta el último «de» (como «Analista de Datos de Empresa X»): es solo para el demo
const NEW_JOB_RE = /(agreg[áa] la oferta (.{3,80})) de (.{1,80}?)(?=[.,:;!?]|$)/iu;
const URL_RE = /https?:\/\/[^\s<>"]{1,300}/u;
/** En modo demo la ruta pasa como `system` solo una línea de datos con la oferta en pantalla. */
const SCREEN_JOB_RE = /screen_job_id=([0-9a-f-]{36})/u;

type DemoAction = { toolName: string; input: Record<string, unknown> };

/** Acción reconocible en el mensaje (AG-5), con la cita EXACTA que la fundamenta. */
function demoAction(message: string, system: string): DemoAction | null {
  const applied = APPLIED_RE.exec(message);
  const jobId = SCREEN_JOB_RE.exec(system)?.[1];
  if (applied && jobId && !NOT_APPLIED_RE.test(message)) {
    return {
      toolName: "propose_status_change",
      input: { job_id: jobId, event: "apply", source: { from: "message", quote: applied[0] } },
    };
  }
  const job = NEW_JOB_RE.exec(message);
  if (job) {
    const url = URL_RE.exec(message)?.[0];
    return {
      toolName: "propose_new_job",
      input: {
        title: job[2]!.trim(),
        company: job[3]!.trim(),
        ...(url ? { url } : {}),
        source: { from: "message", quote: job[1]! },
      },
    };
  }
  return null;
}

/**
 * Guion por reglas sobre el último mensaje de la persona:
 * - sin resultado de tool todavía: si reconoce una acción (AG-5: «ya me postulé» con una oferta en
 *   pantalla, «agregá la oferta X de Y») y su tool está activa, la llama; si reconoce un cambio del
 *   perfil y `propose_profile` está activa,
 *   la llama; si no, y `get_profile` está activa, lee el perfil; si no, contesta en texto;
 * - con resultado de tool: texto fijo «DEMO: …» y fin.
 */
export const demoAgentStreamFn: AgentStreamFn = async function* (args) {
  const last = args.messages.at(-1);
  if (last?.role === "tool") {
    const proposed = last.results.some((r) => r.name.startsWith("propose_") && !r.isError);
    yield {
      type: "text-delta",
      text: proposed
        ? "DEMO: te dejé una propuesta. Revisala y, si te sirve, cargala en el formulario."
        : "DEMO: leí tus datos. Decime qué querés cambiar.",
    };
    yield DEMO_USAGE;
    return;
  }
  const userText = [...args.messages].reverse().find((m) => m.role === "user");
  const message = userText?.role === "user" ? userText.content : "";
  const action = demoAction(message, args.system);
  const change = demoProfileChange(message);
  if (action && args.activeTools.includes(action.toolName)) {
    yield { type: "tool-call", toolCallId: "demo-0", ...action };
  } else if (change && args.activeTools.includes("propose_profile")) {
    yield {
      type: "tool-call",
      toolCallId: "demo-0",
      toolName: "propose_profile",
      input: { changes: [change] },
    };
  } else if (args.activeTools.includes("get_profile")) {
    yield { type: "tool-call", toolCallId: "demo-0", toolName: "get_profile", input: {} };
  } else {
    yield { type: "text-delta", text: "DEMO: asistente de prueba, sin modelo." };
  }
  yield DEMO_USAGE;
};

/**
 * Dependencias del modo demo: ruta `assistant_chat` estática (proveedor y modelo "fake", tarifas 0)
 * y un registro que devuelve un modelo de mentira, que el guion nunca usa. Con `LLM_DEMO=1` la app
 * usa esto en vez de `model_routing`: así un e2e no puede llamar a un modelo pago.
 */
export function createDemoAgentDeps(options: { calls: CallSink }): StreamAgentDeps {
  const providers: ProviderRegistry = {
    modelFor: (provider) => (provider === DEMO_AGENT_MODEL ? ({} as LanguageModel) : null),
  };
  return {
    routes: staticRouteSource([
      {
        task: ASSISTANT_TASK,
        provider: DEMO_AGENT_MODEL,
        model: DEMO_AGENT_MODEL,
        fallbackModel: null,
        temperature: 0,
        maxTokens: 600,
        thinkingLevel: null,
        inputUsdPerMtok: 0,
        outputUsdPerMtok: 0,
        fallbackInputUsdPerMtok: null,
        fallbackOutputUsdPerMtok: null,
      },
    ]),
    calls: options.calls,
    providers,
    streamFn: demoAgentStreamFn,
  };
}
