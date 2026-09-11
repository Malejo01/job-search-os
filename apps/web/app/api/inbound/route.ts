import { createDb, requireDatabaseUrl } from "@job-search-os/db";
import {
  createLogger,
  fetchReceivedEmail,
  handleInboundEmail,
  pgBlobStorage,
  ResendAnyEventSchema,
  ResendReceivedEventSchema,
  verifySvix,
} from "@job-search-os/adapters";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Webhook de email entrante (JS-020, ADR-003). Resend (vía Svix) hace POST por cada email que
 * llega a ingest.<dominio>. Firma obligatoria: sin firma válida es 401 y no se toca la base.
 * Corre como servicio (dueño de la base) y filtra por el usuario dueño de la dirección.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const rawBody = await request.text();
  const verdict = verifySvix(
    {
      "svix-id": request.headers.get("svix-id"),
      "svix-timestamp": request.headers.get("svix-timestamp"),
      "svix-signature": request.headers.get("svix-signature"),
    },
    rawBody,
    process.env.RESEND_WEBHOOK_SECRET,
  );
  if (!verdict.ok) {
    return NextResponse.json({ error: `firma inválida: ${verdict.reason}` }, { status: 401 });
  }

  let parsedAny: unknown;
  try {
    parsedAny = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "cuerpo no es JSON" }, { status: 400 });
  }
  const any = ResendAnyEventSchema.safeParse(parsedAny);
  if (!any.success) return NextResponse.json({ error: "evento inválido" }, { status: 400 });
  if (any.data.type !== "email.received") {
    return NextResponse.json({ ok: true, ignored: any.data.type });
  }
  const event = ResendReceivedEventSchema.safeParse(parsedAny);
  if (!event.success) {
    return NextResponse.json({ error: "payload de email.received inválido" }, { status: 400 });
  }

  const logger = createLogger({ webhook: "inbound" });
  const { db, close } = createDb(requireDatabaseUrl({ purpose: "service" }), { max: 2 });
  try {
    const apiKey = process.env.RESEND_API_KEY;
    let content = null;
    if (apiKey) {
      try {
        content = await fetchReceivedEmail(event.data.data.email_id, apiKey);
      } catch (e) {
        logger.warn({ err: e instanceof Error ? e.message : String(e) }, "inbound: sin cuerpo");
      }
    }
    const outcome = await handleInboundEmail(event.data, content, rawBody, {
      db,
      storage: pgBlobStorage(db),
      logger,
    });
    const status = outcome.kind === "rate_limited" ? 429 : 200;
    return NextResponse.json({ ok: outcome.kind !== "rate_limited", ...outcome }, { status });
  } catch (error) {
    logger.error({ err: error instanceof Error ? error.message : String(error) }, "inbound falló");
    // 500 para que Svix reintente
    return NextResponse.json({ ok: false, error: "inbound falló" }, { status: 500 });
  } finally {
    await close();
  }
}
