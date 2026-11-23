import {
  buildCvDocx,
  cvOfferFileName,
  reorderCvBullets,
  type CvDocument,
} from "@job-search-os/pipeline";
import { z } from "zod";
import { applyCvTailorProposal } from "@/lib/cv-tailor/server";
import { isUuid } from "@/lib/ids";
import { buildUserCv, parseCvOptions } from "@/lib/cv-source";
import { sessionUserId } from "@/lib/session";
import { getPostularData } from "../data";

export const dynamic = "force-dynamic";

/** Tope del campo `proposal` (JSON de la versión adaptada): una propuesta real pesa pocos KB. */
const PROPOSAL_MAX_CHARS = 60_000;
const proposalField = z.string().min(2).max(PROPOSAL_MAX_CHARS);

function json(status: number, error: string): Response {
  return Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}

function docxResponse(doc: CvDocument, title: string, company: string): Response {
  const bytes = buildCvDocx(doc);
  return new Response(bytes.slice().buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${cvOfferFileName(title, company)}"`,
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/**
 * Descarga del CV para esta oferta (R20-05, R20-04b). El usuario sale de la sesión, nunca de un parámetro,
 * y la oferta tiene que ser suya (`getPostularData` filtra por persona con RLS). El archivo se arma en
 * memoria y se responde directo: no se guarda en ningún lado.
 *
 * - GET: el CV confirmado con las viñetas reordenadas por coincidencia con la oferta, sin reescribir.
 * - POST: con una propuesta de la versión adaptada (R20-04) en el campo `proposal`. No se confía en ella:
 *   `applyCvTailorProposal` la vuelve a verificar contra el CV de hoy, sin modelo y sin cupo. Si el flag está
 *   apagado, no hay propuesta o la verificación la descarta, cae a la versión de GET.
 */
async function build(
  params: Promise<{ id: string }>,
  proposalRaw: string | null,
): Promise<Response> {
  const userId = await sessionUserId();
  if (!userId) return json(401, "Iniciá sesión para descargar tu CV.");
  const { id } = await params;
  if (!isUuid(id)) return json(404, "No encontramos esa oferta.");
  try {
    const data = await getPostularData(userId, id);
    if (!data) return json(404, "No encontramos esa oferta.");
    if (proposalRaw !== null) {
      let proposal: unknown = null;
      try {
        proposal = JSON.parse(proposalRaw);
      } catch {
        proposal = null;
      }
      const applied = proposal ? await applyCvTailorProposal(userId, proposal) : null;
      if (applied) return docxResponse(applied.document, data.title, data.company);
    }
    const doc = await buildUserCv(
      userId,
      parseCvOptions({ lang: undefined, email: undefined, basicas: undefined }),
    );
    if (!doc) return json(404, "Completá tu perfil para armar el CV.");
    return docxResponse(reorderCvBullets(doc, data.offerSkills), data.title, data.company);
  } catch {
    return json(500, "No pudimos armar tu CV. Probá de nuevo en un rato.");
  }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return build(params, null);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > PROPOSAL_MAX_CHARS * 4) return json(413, "La propuesta es demasiado grande.");
  let raw: string | null;
  try {
    const form = await request.formData();
    const parsed = proposalField.safeParse(form.get("proposal"));
    raw = parsed.success ? parsed.data : null;
  } catch {
    raw = null;
  }
  // Sin propuesta válida no se rechaza: se baja la versión sin IA
  return build(params, raw);
}
