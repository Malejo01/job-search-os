import {
  createLogger,
  cvChatLabel,
  newCvConversationId,
  runCvInterviewTurn,
  runCvWrite,
} from "@job-search-os/adapters";
import { createDb, requireDatabaseUrl, type Db } from "@job-search-os/db";
import {
  applyCvWrite,
  CV_CHAT_MAX_TURNS,
  CV_WRITE_OUTPUT_SCHEMA,
  cvChatCapNotice,
  cvChatCloseReason,
  cvChatCapReason,
  cvChatDailyCapUsd,
  cvChatHistory,
  cvChecklistProgress,
  cvChatWindows,
  cvTopicQuestion,
  initialCvChatState,
  nextCvTopic,
  parseCvChatState,
  skipCvTopic,
  validateHistory,
  type CvChatCap,
  type CvChatState,
  type CvHistoryInput,
  type CvWriteInput,
} from "@job-search-os/pipeline";
import { z } from "zod";
import {
  buildChatPreview,
  cvChatAllowed,
  loadChatSeed,
  measureCvChat,
  saveChatHistory,
  skillCatalogNames,
  type CvChatMeasures,
} from "@/lib/cv-chat-server";
import { originAllowed, signCvTicket, verifyCvTicket } from "@/lib/cv-chat-ticket";
import { serviceLlm } from "@/lib/llm-service";
import { isOnboardingComplete } from "@/lib/onboarding";
import { sessionUserId } from "@/lib/session";
import { siteUrl } from "@/lib/site-url";
import { getUserPlan } from "@/lib/user-plan";
import { needsTermsAcceptance } from "@/lib/terms-status";

export const dynamic = "force-dynamic";

const MAX_BODY_CHARS = 120_000;

type ErrorCode =
  | "bad_origin"
  | "bad_request"
  | "unauthorized"
  | "not_ready"
  | "not_found"
  | "bad_ticket"
  | "too_long"
  | "empty"
  | "injection"
  | "pasted_cv"
  | "capped"
  | "already_written"
  | "llm_unavailable"
  | "server";

/** Mensajes fijos para la persona: nunca el texto del modelo ni el de una excepción. */
const MESSAGES: Record<Exclude<ErrorCode, "capped">, string> = {
  bad_origin: "Pedido no permitido.",
  bad_request: "No entendimos el pedido. Recargá la página e intentá de nuevo.",
  unauthorized: "Iniciá sesión para armar tu CV.",
  not_ready: "Antes completá los términos y tu perfil.",
  not_found: "No encontramos esta página.",
  bad_ticket: "La charla venció. Empezá de nuevo; lo que ya confirmaste en tu historial sigue ahí.",
  too_long: "El mensaje es muy largo. Contalo en pocas líneas.",
  empty: "Escribí una respuesta o tocá «Saltear».",
  injection: "No pudimos usar ese mensaje. Contestá la pregunta con tus palabras.",
  pasted_cv:
    "Parece que pegaste un CV entero. Acá te preguntamos de a una cosa: contestá con tus palabras o cargá tu historial a mano.",
  already_written: "Este CV ya se redactó en esta charla. Revisalo y confirmalo.",
  llm_unavailable:
    "Ahora no puedo responder. Podés cargar tu historial a mano desde las pantallas.",
  server: "No pudimos completar el pedido. Probá de nuevo en un rato.",
};

const STATUS: Record<ErrorCode, number> = {
  bad_origin: 403,
  bad_request: 400,
  unauthorized: 401,
  not_ready: 403,
  not_found: 404,
  bad_ticket: 409,
  too_long: 413,
  empty: 422,
  injection: 422,
  pasted_cv: 422,
  capped: 429,
  already_written: 409,
  llm_unavailable: 503,
  server: 500,
};

const NO_STORE = { "Cache-Control": "no-store" };

function fail(code: Exclude<ErrorCode, "capped">, extra: Record<string, unknown> = {}): Response {
  return Response.json(
    { ok: false, error: code, message: MESSAGES[code], ...extra },
    { status: STATUS[code], headers: NO_STORE },
  );
}

function capped(cap: CvChatCap): Response {
  return Response.json(
    { ok: false, error: "capped", cap, ...cvChatCapNotice(cap) },
    { status: 429, headers: NO_STORE },
  );
}

function succeed(body: Record<string, unknown>): Response {
  return Response.json({ ok: true, ...body }, { headers: NO_STORE });
}

const stateField = z.unknown();
const requestSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("start") }),
  z.strictObject({
    action: z.literal("turn"),
    ticket: z.string(),
    state: stateField,
    message: z.string(),
  }),
  z.strictObject({ action: z.literal("skip"), ticket: z.string(), state: stateField }),
  z.strictObject({
    action: z.literal("write"),
    ticket: z.string(),
    state: stateField,
    lang: z.enum(["es", "en"]),
  }),
  z.strictObject({
    action: z.literal("confirm"),
    ticket: z.string(),
    history: z.array(z.unknown()).max(20),
  }),
]);

/** Una entrada del historial pasa por la misma validación que la carga manual. */
function checkEntry(raw: unknown): CvHistoryInput | null {
  if (!raw || typeof raw !== "object") return null;
  const e = raw as Record<string, unknown>;
  const bullets = Array.isArray(e.bullets) ? e.bullets : [];
  if (!bullets.every((b) => typeof b === "string")) return null;
  const form = {
    get: (name: string): unknown =>
      name === "bullets" ? (bullets as string[]).join("\n") : (e[name] ?? ""),
  };
  const checked = validateHistory(form);
  return checked.ok ? checked.value : null;
}

const fmtLanguage = (l: { name: string; level: string | null }): string =>
  l.level ? `${l.name}: ${l.level}` : l.name;

export async function POST(request: Request): Promise<Response> {
  // Mismo origen, siempre: es un POST con cookie de sesión
  const allowed = [new URL(request.url).origin, siteUrl()];
  if (process.env.AUTH_URL) allowed.push(process.env.AUTH_URL);
  if (!originAllowed(request.headers.get("origin"), allowed)) return fail("bad_origin");

  const userId = await sessionUserId();
  if (!userId) return fail("unauthorized");
  // Lo mismo que `requireActiveUserId`, sin redirigir: es una API
  if ((await needsTermsAcceptance(userId)) || !(await isOnboardingComplete(userId))) {
    return fail("not_ready");
  }
  if (!(await cvChatAllowed(userId))) return fail("not_found");

  const text = await request.text();
  if (text.length > MAX_BODY_CHARS) return fail("too_long");
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return fail("bad_request");
  }
  const parsed = requestSchema.safeParse(json);
  if (!parsed.success) return fail("bad_request");
  const req = parsed.data;

  const now = Date.now();
  const secret = process.env.AUTH_SECRET;
  const logger = createLogger({ user_id: userId, trigger: "cv_chat" });

  let ticket = { conversationId: "", turns: 0 };
  if (req.action !== "start") {
    const t = verifyCvTicket(secret, userId, req.ticket, now);
    if (!t) return fail("bad_ticket");
    ticket = t;
  } else {
    ticket = { conversationId: newCvConversationId(), turns: 0 };
  }
  const label = cvChatLabel(ticket.conversationId);
  const issue = (turns: number): string | null =>
    signCvTicket(secret, userId, { conversationId: ticket.conversationId, turns }, Date.now());

  let conn: ReturnType<typeof createDb> | null = null;
  try {
    // Confirmar no llama al modelo ni mide gasto
    if (req.action === "confirm") {
      const entries = req.history.map(checkEntry);
      if (entries.some((e) => e === null)) return fail("bad_request");
      const saved = await saveChatHistory(userId, entries as CvHistoryInput[]);
      logger.info({ run_id: ticket.conversationId, ...saved }, "cv chat: historial confirmado");
      return succeed({ saved });
    }

    conn = createDb(requireDatabaseUrl({ purpose: "service" }), { max: 1 });
    const db: Db = conn.db;
    const windows = cvChatWindows(new Date(now));
    const measures: CvChatMeasures = await measureCvChat(db, {
      userId,
      label,
      monthSince: windows.monthSince,
      daySince: windows.daySince,
    });
    const plan = await getUserPlan(userId, new Date(now));
    const capInput = (turns: number) => ({
      turns,
      conversationCostUsd: measures.conversationCostUsd,
      cvThisMonth: measures.cvThisMonth,
      cvPerMonth: plan.plan.limits.cvReadsPerMonth,
      dailySpendUsd: measures.dailySpendUsd,
      dailyCapUsd: cvChatDailyCapUsd(process.env),
    });

    if (req.action === "start") {
      const cap = cvChatCapReason(capInput(0));
      if (cap) return capped(cap);
      const state = initialCvChatState(await loadChatSeed(userId));
      const first = nextCvTopic(state);
      const t = issue(0);
      if (!t) return fail("server");
      return succeed({
        ticket: t,
        state,
        question: first ? cvTopicQuestion(first, state) : null,
        progress: cvChecklistProgress(state),
        maxTurns: CV_CHAT_MAX_TURNS,
      });
    }

    const state0 = parseCvChatState(req.state);
    if (!state0) return fail("bad_request");
    // Los turnos los fija el ticket firmado, no el navegador
    const state: CvChatState = { ...state0, turns: ticket.turns };
    const llm = serviceLlm(db, logger);

    if (req.action === "turn" || req.action === "skip") {
      const cap = cvChatCapReason(capInput(ticket.turns));
      if (cap) return capped(cap);
      const topic = nextCvTopic(state);
      if (!topic) {
        const t = issue(ticket.turns);
        return t
          ? succeed({
              ticket: t,
              state,
              ack: null,
              question: null,
              closed: "complete",
              progress: cvChecklistProgress(state),
            })
          : fail("server");
      }
      let next: CvChatState;
      let ack: string | null = null;
      if (req.action === "skip") {
        next = skipCvTopic(state, topic);
      } else {
        const out = await runCvInterviewTurn(
          { llm },
          { userId, conversationId: ticket.conversationId, state, topic, message: req.message },
        );
        if (out.kind === "redirect_cv_reader") {
          return fail("pasted_cv", { href: "/settings/historial" });
        }
        if (out.kind === "rejected") return fail(out.reason);
        if (out.kind === "error") {
          logger.warn(
            { run_id: ticket.conversationId, llm_error: out.error.kind },
            "cv chat: el modelo no respondió",
          );
          return fail("llm_unavailable");
        }
        next = out.state;
        ack = out.ack;
      }
      const upcoming = nextCvTopic(next);
      const closed = cvChatCloseReason(next);
      const t = issue(next.turns);
      if (!t) return fail("server");
      return succeed({
        ticket: t,
        state: next,
        ack,
        question: closed === null && upcoming ? cvTopicQuestion(upcoming, next) : null,
        closed,
        progress: cvChecklistProgress(next),
      });
    }

    // write: redactar con IA, verificar y armar la vista previa. No guarda nada.
    if (measures.writesInConversation >= 1) return fail("already_written");
    const cap = cvChatCapReason(capInput(0));
    if (cap) return capped(cap);
    const chatOnly = cvChatHistory({ ...state, confirmed: [] });
    const input: CvWriteInput = {
      lang: req.lang,
      target: state.target,
      history: chatOnly,
      skills: state.skills,
      languages: state.languages.map(fmtLanguage),
    };
    const hasWork = chatOnly.some((h) => h.kind === "trabajo");
    let written = applyCvWrite(input, CV_WRITE_OUTPUT_SCHEMA.parse({ summary: "", entries: [] }));
    let usedModel = false;
    if (hasWork) {
      const r = await runCvWrite(
        { llm },
        {
          userId,
          conversationId: ticket.conversationId,
          input,
          knownTerms: await skillCatalogNames(db),
        },
      );
      if (r.ok) {
        written = r.value;
        usedModel = true;
        logger.info(
          { run_id: ticket.conversationId, ...r.value.stats },
          "cv chat: redacción verificada",
        );
      } else {
        logger.warn(
          { run_id: ticket.conversationId, llm_error: r.error.kind },
          "cv chat: sin redacción, va el texto de la persona",
        );
      }
    }
    const doc = await buildChatPreview(userId, {
      lang: req.lang,
      history: written.history,
      summary: written.summary,
      extras: {
        skills: state.skills,
        languages: state.languages,
        links: state.links,
        target: state.target,
      },
    });
    if (!doc) return fail("server");
    const t = issue(ticket.turns);
    if (!t) return fail("server");
    return succeed({
      ticket: t,
      doc,
      written: { history: written.history, summary: written.summary },
      usedModel,
      stats: written.stats,
    });
  } catch (e) {
    // Nunca el mensaje de la excepción: puede citar datos de la persona
    logger.error(
      { run_id: ticket.conversationId, err: e instanceof Error ? e.name : "error" },
      "cv chat falló",
    );
    return fail("server");
  } finally {
    await conn?.close();
  }
}
