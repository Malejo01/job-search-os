import { createLogger, originAllowed } from "@job-search-os/adapters";
import {
  CV_COACH_DRAFT_MAX_CARDS,
  cvCoachCardSchema,
  screenCoachCard,
  type CvCoachCard,
} from "@job-search-os/pipeline";
import { z } from "zod";
import { requireCvCoach } from "@/lib/cv-coach/access";
import { discardDraft, loadCoachDraft, saveCoachDraft } from "@/lib/cv-draft";
import { bodyBytesForChars, readBodyLimited } from "@/lib/read-body-limited";
import { sessionUserId } from "@/lib/session";
import { siteUrl } from "@/lib/site-url";
import { needsTermsAcceptance } from "@/lib/terms-status";

export const dynamic = "force-dynamic";

/**
 * Borrador del coach de CV (R33-02): las propuestas (tarjetas) que la persona todavía no confirmó, para que no
 * se pierdan si cierra la pestaña. NO es el CV: una tarjeta solo entra a `career_history` con su clic en
 * `/api/cv-coach/turno` (acción `confirm`), que la vuelve a validar. Acá solo se guarda y se lee.
 *
 * Orden: origen (403) → sesión (401) → flag del coach (404) → términos (403) → cuerpo. Todo con la RLS de la
 * persona (`cv_drafts`, rls/0075): nadie lee el borrador de otra. Sin modelo, sin gasto. Mensajes fijos: nunca el
 * texto de una excepción ni de la propuesta. Acciones: `load`, `save` y `discard`.
 */
const MAX_BODY_CHARS = 40_000;
const NO_STORE = { "Cache-Control": "no-store" };

const MESSAGES = {
  bad_origin: "Pedido no permitido.",
  unauthorized: "Iniciá sesión para seguir.",
  not_found: "No encontramos esta página.",
  not_ready: "Antes completá los términos.",
  bad_request: "No entendimos el pedido. Recargá la página e intentá de nuevo.",
  too_long: "El borrador es muy largo.",
  server: "No pudimos completar el pedido. Probá de nuevo en un rato.",
} as const;
const STATUS = {
  bad_origin: 403,
  unauthorized: 401,
  not_found: 404,
  not_ready: 403,
  bad_request: 400,
  too_long: 413,
  server: 500,
} as const;

function fail(code: keyof typeof MESSAGES): Response {
  return Response.json(
    { ok: false, error: code, message: MESSAGES[code] },
    { status: STATUS[code], headers: NO_STORE },
  );
}

const requestSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("load") }),
  z.strictObject({
    action: z.literal("save"),
    cards: z.array(z.unknown()).max(CV_COACH_DRAFT_MAX_CARDS),
  }),
  z.strictObject({ action: z.literal("discard") }),
]);

export async function POST(request: Request): Promise<Response> {
  const allowed = [new URL(request.url).origin, siteUrl()];
  if (process.env.AUTH_URL) allowed.push(process.env.AUTH_URL);
  if (!originAllowed(request.headers.get("origin"), allowed)) return fail("bad_origin");

  const access = await requireCvCoach(sessionUserId);
  if (!access.ok) return fail(access.stage === "session" ? "unauthorized" : "not_found");
  const userId = access.userId;
  if (await needsTermsAcceptance(userId)) return fail("not_ready");

  const limited = await readBodyLimited(request, bodyBytesForChars(MAX_BODY_CHARS));
  if (!limited.ok || limited.text.length > MAX_BODY_CHARS) return fail("too_long");
  let json: unknown;
  try {
    json = JSON.parse(limited.text);
  } catch {
    return fail("bad_request");
  }
  const parsed = requestSchema.safeParse(json);
  if (!parsed.success) return fail("bad_request");
  const req = parsed.data;
  const logger = createLogger({ user_id: userId, trigger: "cv_coach_draft" });

  try {
    if (req.action === "load") {
      const draft = await loadCoachDraft(userId);
      return Response.json({ ok: true, cards: draft?.cards ?? [] }, { headers: NO_STORE });
    }
    if (req.action === "discard") {
      await discardDraft(userId, "coach");
      return Response.json({ ok: true }, { headers: NO_STORE });
    }
    // save: cada tarjeta se valida y se filtra igual que al confirmar; una que no pasa se descarta, no se repara
    const cards: CvCoachCard[] = [];
    for (const raw of req.cards) {
      const card = cvCoachCardSchema.safeParse(raw);
      if (card.success && screenCoachCard(card.data) === null) cards.push(card.data);
    }
    const saved = await saveCoachDraft(userId, cards);
    if (!saved) return fail("too_long");
    return Response.json({ ok: true, saved: cards.length }, { headers: NO_STORE });
  } catch {
    // Nunca el mensaje de la excepción: puede citar datos de la persona
    logger.error({}, "coach: el borrador falló");
    return fail("server");
  }
}
