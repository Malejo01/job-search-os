import { createLogger, readCvForAgent } from "@job-search-os/adapters";
import { createDb, requireDatabaseUrl } from "@job-search-os/db";
import {
  PROFILE_READ_ERRORS,
  PROFILE_READ_MAX_BODY_CHARS,
  profileAgentCapNotice,
  profileReadErrorFor,
  profileReadRequestSchema,
  type ProfileAgentCap,
  type ProfileReadErrorCode,
} from "@job-search-os/pipeline";
import { originAllowed } from "@/lib/cv-chat-ticket";
import { serviceLlm } from "@/lib/llm-service";
import {
  buildReadSummary,
  getSessionEmail,
  loadReadContext,
  profileAgentAllowedFor,
} from "@/lib/profile-agent/read-server";
import { sessionUserId } from "@/lib/session";
import { siteUrl } from "@/lib/site-url";
import { needsTermsAcceptance } from "@/lib/terms-status";

export const dynamic = "force-dynamic";
// La lectura llama al modelo (tope de 45 s con respaldo): hace falta margen sobre el default
export const maxDuration = 60;

const NO_STORE = { "Cache-Control": "no-store" };

function fail(code: Exclude<ProfileReadErrorCode, "capped">): Response {
  const { status, message } = PROFILE_READ_ERRORS[code];
  return Response.json({ ok: false, error: code, message }, { status, headers: NO_STORE });
}

function capped(cap: ProfileAgentCap): Response {
  return Response.json(
    { ok: false, error: "capped", cap, ...profileAgentCapNotice(cap) },
    { status: 429, headers: NO_STORE },
  );
}

/**
 * Lee el CV (ADR-034, R10-1). El navegador manda SOLO el texto que extrajo: el archivo no se sube ni se
 * guarda, y el servidor vuelve a normalizar y redactar el texto antes del modelo. Devuelve conteos y un
 * ticket firmado para las etapas que siguen; nada del CV se guarda.
 *
 * Orden (O7): sesión (401), flag (404), origen (403), términos (403), cuerpo, y recién ahí el cupo y los
 * topes dentro del adaptador. Sin sesión no se toca la base ni el modelo.
 */
export async function POST(request: Request): Promise<Response> {
  const userId = await sessionUserId();
  if (!userId) return fail("unauthorized");
  if (!(await profileAgentAllowedFor(userId))) return fail("not_found");

  // Mismo origen, siempre: es un POST con cookie de sesión
  const allowed = [new URL(request.url).origin, siteUrl()];
  if (process.env.AUTH_URL) allowed.push(process.env.AUTH_URL);
  if (!originAllowed(request.headers.get("origin"), allowed)) return fail("bad_origin");

  // Los términos sí; el onboarding completo no: esta pantalla también es el primer paso del onboarding
  if (await needsTermsAcceptance(userId)) return fail("not_ready");

  const raw = await request.text();
  if (raw.length > PROFILE_READ_MAX_BODY_CHARS) return fail("too_long");
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return fail("bad_request");
  }
  const parsed = profileReadRequestSchema.safeParse(json);
  if (!parsed.success) return fail("bad_request");

  const now = new Date();
  const logger = createLogger({ user_id: userId, trigger: "profile_read" });
  const conn = createDb(requireDatabaseUrl({ purpose: "service" }), { max: 1 });
  try {
    const [email, ctx] = await Promise.all([getSessionEmail(userId), loadReadContext(userId, now)]);
    const result = await readCvForAgent(
      {
        userId,
        email,
        text: parsed.data.text,
        displayName: ctx.displayName,
        roles: ctx.roles,
        taxonomy: ctx.taxonomy,
        roleSkillSlugs: ctx.roleSkillSlugs,
        plan: ctx.plan,
      },
      { db: conn.db, llm: serviceLlm(conn.db, logger), logger, now: () => now },
    );
    if (!result.ok) {
      const { code, cap } = result.error;
      if (code === "capped" && cap) return capped(cap);
      return fail(profileReadErrorFor(code));
    }
    return Response.json(
      {
        ok: true,
        ticket: result.value.ticket,
        summary: buildReadSummary(result.value.proposal),
      },
      { headers: NO_STORE },
    );
  } catch (e) {
    // Nunca el mensaje de la excepción: puede citar datos de la persona
    logger.error({ err: e instanceof Error ? e.name : "error" }, "profile read falló");
    return fail("server");
  } finally {
    await conn.close();
  }
}
