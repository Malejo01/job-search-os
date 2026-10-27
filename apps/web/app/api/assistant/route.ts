import { randomBytes } from "node:crypto";
import {
  ASSISTANT_TASK,
  cachedRouteSource,
  createDemoAgentDeps,
  createLogger,
  createProviderRegistry,
  drizzleRouteSource,
  safeDbError,
  streamAgent,
  type AgentChatMessage,
  type Logger,
  type RouteSource,
  type StreamAgentDeps,
} from "@job-search-os/adapters";
import {
  activeToolsFor,
  ASSISTANT_ERROR_MESSAGE,
  capMessage,
  checkTurnStart,
  conversationIdFromBytes,
  conversationLabel,
  CV_REDIRECT_LINKS,
  CV_REDIRECT_MESSAGE,
  encodeAssistantEvent,
  groundingSourcesFrom,
  isProposeTool,
  MAX_ASSISTANT_BODY_BYTES,
  modelMessagesFrom,
  monthlyConversationLimit,
  parseAssistantRequest,
  proposalLogMeta,
  sameOriginRequest,
  sanitizeHistory,
  screenLabel,
  screenUserMessage,
  summarizeHistory,
  turnsUsed,
  validateHistory,
  type AgentCapReason,
  type AssistantRequest,
  type AssistantStreamEvent,
} from "@job-search-os/pipeline";
import { loadPrompt, renderPrompt } from "@job-search-os/prompts";
import { canUseAssistant } from "@/lib/assistant";
import { assistantTools, isProposeOutput } from "@/lib/assistant-tools";
import { assistantCallSink, loadAssistantUsage } from "@/lib/assistant-usage";
import { getAppDb } from "@/lib/db";
import { getProfileForEdit, isOnboardingComplete } from "@/lib/onboarding";
import { sessionUserId } from "@/lib/session";
import { needsTermsAcceptance } from "@/lib/terms-status";
import { getUserPlan } from "@/lib/user-plan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// El turno tiene su propio deadline de 50 s (AGENT_DEADLINE_MS); esto es el techo de Vercel
export const maxDuration = 60;

/**
 * Asistente (Fase 7, etapa 3, AG-3): lee, explica y PROPONE. Nada se escribe sin el clic de la
 * persona: las tools no escriben, la propuesta vuelve como tarjeta y la guarda la Server Action de
 * la pantalla cuando la persona toca Guardar. Solo para admins (`ASSISTANT_ENABLED=admin`).
 *
 * No va por /api/mcp (que es de un solo usuario): usa la sesión. Todo falla cerrado: origen,
 * sesión, términos, onboarding, gate, cuerpo, CV pegado, topes (de `llm_calls`, en el servidor),
 * prompt y modelo. La charla no se guarda: solo filas de `llm_calls` con `label = conv:<id>`, sin
 * contenido. Los logs llevan `user_id`, `run_id` (el id de la charla), códigos y conteos.
 */

const PROMPT_REF = "assistant_chat@v1" as const;
/** Reglas de las propuestas: van después del prompt de charla, en el mismo sistema. */
const PROPOSE_PROMPT_REF = "assistant_propose@v1" as const;

/** Una charla en curso por persona y por instancia (dos pestañas no duplican el gasto). */
const busy = new Set<string>();

let routes: RouteSource | null = null;
const routeSource = (): RouteSource =>
  (routes ??= cachedRouteSource(drizzleRouteSource(getAppDb())));

const jsonError = (status: number, error: string) =>
  Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });

const CAP_EVENT = (reason: AgentCapReason): AssistantStreamEvent => ({
  type: "notice",
  ...capMessage(reason),
});

export async function POST(req: Request): Promise<Response> {
  const h = req.headers;
  if (
    !sameOriginRequest({
      origin: h.get("origin"),
      host: h.get("host"),
      forwardedHost: h.get("x-forwarded-host"),
      forwardedProto: h.get("x-forwarded-proto"),
      secFetchSite: h.get("sec-fetch-site"),
      contentType: h.get("content-type"),
      requestUrl: req.url,
    })
  ) {
    return jsonError(403, "origen");
  }

  const userId = await sessionUserId();
  if (!userId) return jsonError(401, "sesion");
  if ((await needsTermsAcceptance(userId)) || !(await isOnboardingComplete(userId))) {
    return jsonError(403, "perfil");
  }
  // Para quien no puede usarlo, la ruta no existe (como /settings/metricas)
  if (!(await canUseAssistant(userId))) return jsonError(404, "no_encontrado");

  const declared = Number(h.get("content-length") ?? "0");
  if (declared > MAX_ASSISTANT_BODY_BYTES) return jsonError(413, "muy_grande");
  const raw = await req.text();
  if (new TextEncoder().encode(raw).length > MAX_ASSISTANT_BODY_BYTES) {
    return jsonError(413, "muy_grande");
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return jsonError(400, "cuerpo");
  }
  const parsed = parseAssistantRequest(body);
  if (!parsed.ok) return jsonError(400, "cuerpo");

  if (busy.has(userId)) return jsonError(429, "en_curso");
  busy.add(userId);

  const conversationId = parsed.value.conversationId ?? conversationIdFromBytes(randomBytes(12));
  const log = createLogger({ user_id: userId, run_id: conversationId, task: ASSISTANT_TASK });
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const emit = (event: AssistantStreamEvent) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(encodeAssistantEvent(event)));
        } catch {
          open = false;
        }
      };
      try {
        emit({ type: "conv", id: conversationId });
        await runTurn(userId, conversationId, parsed.value, req.signal, emit, log);
      } catch (e) {
        log.error({ err: safeDbError(e) }, "asistente: el turno falló");
        emit({ type: "error", message: ASSISTANT_ERROR_MESSAGE });
      } finally {
        busy.delete(userId);
        emit({ type: "done" });
        open = false;
        try {
          controller.close();
        } catch {
          // ya cerrado por el cliente
        }
      }
    },
    cancel() {
      // La persona cerró el panel: req.signal corta el turno y el finally libera el lock
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

async function runTurn(
  userId: string,
  conversationId: string,
  request: AssistantRequest,
  signal: AbortSignal,
  emit: (event: AssistantStreamEvent) => void,
  log: Logger,
): Promise<void> {
  // 1. El mensaje nuevo: un CV no va al modelo (ADR-008), y se mira antes del tope de largo
  const last = request.messages.at(-1)!;
  const screened = screenUserMessage(last.text);
  if (!screened.ok) {
    log.info({ reason: screened.error }, "asistente: mensaje no enviado al modelo");
    emit(
      screened.error === "cv"
        ? { type: "notice", text: CV_REDIRECT_MESSAGE, links: [...CV_REDIRECT_LINKS] }
        : CAP_EVENT("message_too_long"),
    );
    return;
  }

  // 2. Historial del navegador: se sanea (CVs de turnos anteriores) y se valida
  const history = validateHistory(sanitizeHistory(request.messages));
  if (!history.ok) {
    log.warn({ reason: history.error }, "asistente: historial inválido");
    emit({ type: "error", message: ASSISTANT_ERROR_MESSAGE });
    return;
  }
  const messages = history.value;

  // 3. Topes, desde llm_calls (nunca desde lo que dice el navegador)
  const label = conversationLabel(conversationId);
  const now = new Date();
  const [usage, plan] = await Promise.all([
    loadAssistantUsage(userId, label, now),
    getUserPlan(userId, now),
  ]);
  const limit = monthlyConversationLimit(process.env, {
    plan: plan.plan.key,
    planUntil: plan.until,
    now,
  });
  const turns = turnsUsed(messages);
  const start = checkTurnStart(
    { turns, costUsd: usage.conversationCostUsd },
    { used: usage.monthlyConversations, limit },
    usage.conversationRows === 0,
  );
  if (!start.ok) {
    log.info({ reason: start.error, turns }, "asistente: tope al empezar");
    emit(CAP_EVENT(start.error));
    return;
  }

  // 4. Modelo y prompt: demo sin red, o model_routing + prompt versionado (si falta, falla cerrado)
  const calls = assistantCallSink(userId);
  let deps: StreamAgentDeps;
  let system: string;
  if (process.env.LLM_DEMO === "1") {
    deps = { ...createDemoAgentDeps({ calls }), logger: log };
    system = "";
  } else {
    const vars = {
      screen_label: request.screen ? screenLabel(request.screen.screen) : "sin pantalla",
      screen_job_id: request.screen?.jobId ?? "",
      today: now.toISOString().slice(0, 10),
    };
    const parts = ([PROMPT_REF, PROPOSE_PROMPT_REF] as const).map((ref) => {
      const prompt = loadPrompt(ref);
      return prompt.ok ? renderPrompt(prompt.value, vars) : null;
    });
    if (!parts.every((p) => p?.ok)) {
      log.error({ reason: "prompt_missing" }, "asistente: faltan los prompts del asistente");
      emit(CAP_EVENT("cost_unknown"));
      return;
    }
    system = parts.map((p) => (p?.ok ? p.value : "")).join("\n\n");
    deps = {
      routes: routeSource(),
      calls,
      providers: createProviderRegistry(),
      logger: log,
    };
  }

  // 5. Lo que va al modelo: el resumen como datos, los mensajes recientes y las tools
  const { summary, recent } = summarizeHistory(messages, request.outcomes);
  const modelMessages: AgentChatMessage[] = modelMessagesFrom(summary, recent);
  const profile = await getProfileForEdit(userId);
  const sources = groundingSourcesFrom(
    messages,
    [profile?.summary ?? "", profile?.city ?? ""].filter((t) => t.trim() !== ""),
  );
  const tools = assistantTools(userId, sources);

  for await (const event of streamAgent(
    ASSISTANT_TASK,
    {
      system,
      messages: modelMessages,
      tools,
      signal,
      activeTools: (step, state) =>
        activeToolsFor({
          turn: turns,
          step,
          proposalsThisTurn: state.proposalsSoFar,
          screen: request.screen,
        }),
      spentUsd: usage.conversationCostUsd,
      promptVersion: PROMPT_REF,
    },
    { userId, label },
    deps,
  )) {
    switch (event.type) {
      case "text":
        emit({ type: "text", text: event.text });
        break;
      case "tool":
        if (isProposeTool(event.name) && isProposeOutput(event.output)) {
          const out = event.output;
          log.info(
            { tool: event.name, ok: out.ok, ...proposalLogMeta(out.ok ? out.proposal : out) },
            "asistente: propuesta",
          );
          if (out.ok) emit({ type: "proposal", proposal: out.proposal });
        }
        break;
      case "cap":
        emit(CAP_EVENT(event.reason));
        break;
      case "error":
        emit({ type: "error", message: ASSISTANT_ERROR_MESSAGE });
        break;
      case "step":
      case "done":
        break;
    }
  }
}
