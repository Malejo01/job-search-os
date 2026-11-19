import { createDb, requireDatabaseUrl } from "@job-search-os/db";
import {
  createLogger,
  loadInboundContent,
  pgBlobStorage,
  processInboundEvent,
  ResendAnyEventSchema,
  ResendReceivedEventSchema,
  safeDbError,
  SVIX_INVALID_SECRET_REASON,
  verifySvix,
} from "@job-search-os/adapters";
import { NextResponse } from "next/server";
import { readBodyLimited } from "../../../lib/read-body-limited";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Tope del cuerpo del webhook, en bytes. El evento de Resend trae metadatos (el contenido del email se pide
 * aparte por la API), así que un evento real pesa unos pocos KB: 1 MB deja mucho margen y corta lo hostil.
 * Se mira antes de la firma: leer 2 MB para recién entonces descubrir que no estaban firmados es el costo.
 */
const MAX_BODY_BYTES = 1_000_000;

/** El aviso de configuración sale una sola vez por instancia, y nunca con el valor del secreto. */
let invalidSecretLogged = false;

/**
 * Webhook de email entrante (JS-020, ADR-003). Resend (vía Svix) hace POST por cada email que
 * llega a ingest.<dominio>. Firma obligatoria: sin firma válida es 401 y no se toca la base.
 * Corre como servicio (dueño de la base) y filtra por el usuario dueño de la dirección.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const limited = await readBodyLimited(request, MAX_BODY_BYTES);
  if (!limited.ok) return NextResponse.json({ error: "cuerpo demasiado grande" }, { status: 413 });
  const rawBody = limited.text;
  const verdict = verifySvix(
    {
      "svix-id": request.headers.get("svix-id"),
      "svix-timestamp": request.headers.get("svix-timestamp"),
      "svix-signature": request.headers.get("svix-signature"),
    },
    rawBody,
    process.env.RESEND_WEBHOOK_SECRET,
  );
  if (!verdict.ok && verdict.reason === SVIX_INVALID_SECRET_REASON) {
    if (!invalidSecretLogged) {
      invalidSecretLogged = true;
      createLogger({ webhook: "inbound" }).error(
        "inbound: RESEND_WEBHOOK_SECRET con formato inválido",
      );
    }
    return NextResponse.json({ error: "firma inválida" }, { status: 401 });
  }
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
    const fetchContent = async () =>
      apiKey ? loadInboundContent(event.data.data.email_id, apiKey, logger) : null;
    const outcome = await processInboundEvent(event.data, rawBody, fetchContent, {
      db,
      storage: pgBlobStorage(db),
      logger,
    });
    const status = outcome.kind === "rate_limited" ? 429 : 200;
    return NextResponse.json({ ok: outcome.kind !== "rate_limited", ...outcome }, { status });
  } catch (error) {
    logger.error({ err: safeDbError(error) }, "inbound falló");
    // 500 para que Svix reintente
    return NextResponse.json({ ok: false, error: "inbound falló" }, { status: 500 });
  } finally {
    await close();
  }
}
