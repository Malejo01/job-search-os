import {
  createLogger,
  newsEmailSecret,
  safeDbError,
  verifyNewsUnsubscribe,
} from "@job-search-os/adapters";
import { NextResponse, type NextRequest } from "next/server";
import { unsubscribeNewsEmail } from "@/lib/news-email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Baja del email de novedades en un clic y sin iniciar sesión (R32-09). El enlace del email lleva un token firmado
 * (`{user_id}.{firma}`): sin la firma correcta no se hace nada y se muestra el mismo aviso de enlace inválido, sin
 * decir por qué (falla cerrado). La baja es idempotente. Nada de lo que se loguea lleva el email: solo el id.
 *
 * - `GET`: el enlace del cuerpo del email; redirige a una pantalla que confirma.
 * - `POST`: la baja en un clic del propio cliente de correo (`List-Unsubscribe-Post`, RFC 8058); responde 200.
 */
async function unsubscribe(token: unknown): Promise<"ok" | "invalido" | "error"> {
  const secret = newsEmailSecret(process.env);
  const userId = secret ? verifyNewsUnsubscribe(token, secret) : null;
  if (!userId) return "invalido";
  try {
    await unsubscribeNewsEmail(userId);
    createLogger({ user_id: userId, task: "news_email" }).info("baja del email de novedades");
    return "ok";
  } catch (e) {
    createLogger({ user_id: userId, task: "news_email" }).error(
      { err: safeDbError(e) },
      "no se pudo dar de baja del email de novedades",
    );
    return "error";
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const result = await unsubscribe(request.nextUrl.searchParams.get("t"));
  const target = new URL(`/novedades/baja/listo?r=${result}`, request.nextUrl);
  // 303: el navegador sigue con un GET a la pantalla de confirmación; nada se cachea
  return NextResponse.redirect(target, { status: 303, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const result = await unsubscribe(request.nextUrl.searchParams.get("t"));
  return NextResponse.json(
    { ok: result === "ok" },
    {
      status: result === "ok" ? 200 : result === "invalido" ? 400 : 500,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
