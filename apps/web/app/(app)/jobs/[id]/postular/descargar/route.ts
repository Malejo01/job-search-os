import {
  buildCvDocx,
  buildCvPdf,
  cvOfferFileName,
  reorderCvBullets,
  type CvDocument,
} from "@job-search-os/pipeline";
import { z } from "zod";
import { cvDownloadAllowed } from "@/lib/cv-download-rate";
import { applyCvTailorProposal } from "@/lib/cv-tailor/server";
import { loadOfferVersion } from "@/lib/cv-tailor/versions";
import { isUuid } from "@/lib/ids";
import { buildUserCv, parseCvOptions } from "@/lib/cv-source";
import { sessionUserId } from "@/lib/session";
import { getPostularData } from "../data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Tope del campo `proposal` (JSON de la versión adaptada): una propuesta real pesa pocos KB. */
const PROPOSAL_MAX_CHARS = 60_000;
const proposalField = z.string().min(2).max(PROPOSAL_MAX_CHARS);

type Format = "docx" | "pdf";
type Version = "base" | "adaptada";

const NO_STORE = { "Cache-Control": "no-store" } as const;

function json(status: number, error: string, extra: Record<string, string> = {}): Response {
  return Response.json({ error }, { status, headers: { ...NO_STORE, ...extra } });
}

function fileResponse(
  doc: CvDocument,
  title: string,
  company: string,
  format: Format,
  adapted: boolean,
): Response {
  const bytes = format === "pdf" ? buildCvPdf(doc).bytes : buildCvDocx(doc);
  return new Response(bytes.slice().buffer as ArrayBuffer, {
    headers: {
      "Content-Type":
        format === "pdf"
          ? "application/pdf"
          : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${cvOfferFileName(title, company, format, adapted)}"`,
      "Content-Length": String(bytes.byteLength),
      ...NO_STORE,
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/**
 * Descarga del CV para esta oferta (R20-05, R20-04b, R34-02). El usuario sale de la sesión, nunca de un
 * parámetro, y la oferta tiene que ser suya (`getPostularData` filtra por persona con RLS). El archivo se arma
 * en memoria y se responde directo: no se guarda en ningún lado ni hay URL pública.
 *
 * - GET `?version=base|adaptada&formato=docx|pdf` (por defecto base y docx):
 *   - base: el CV confirmado con las viñetas reordenadas por coincidencia con la oferta, sin reescribir.
 *   - adaptada: la versión que la persona guardó para esta oferta; se vuelve a verificar contra el CV de hoy
 *     (`applyCvTailorProposal`). Si ya no coincide o no hay, 409 y no se cae en silencio a otra versión.
 * - POST con una propuesta de la versión adaptada (R20-04) en el campo `proposal`: se vuelve a verificar y, si
 *   no sirve, cae a la versión base (comportamiento de la R20).
 */
async function build(
  params: Promise<{ id: string }>,
  opts: { proposalRaw: string | null; format: Format; version: Version },
): Promise<Response> {
  const userId = await sessionUserId();
  if (!userId) return json(401, "Iniciá sesión para descargar tu CV.");
  const { id } = await params;
  if (!isUuid(id)) return json(404, "No encontramos esa oferta.");
  const rate = cvDownloadAllowed(userId);
  if (!rate.allowed) {
    return json(429, "Descargaste muchas veces seguidas. Probá de nuevo en un rato.", {
      "Retry-After": String(rate.retryAfterSeconds),
    });
  }
  try {
    const data = await getPostularData(userId, id);
    if (!data) return json(404, "No encontramos esa oferta.");
    if (opts.version === "adaptada") {
      const saved = await loadOfferVersion(userId, id);
      if (!saved) return json(404, "Todavía no guardaste una versión adaptada para esta oferta.");
      const applied = await applyCvTailorProposal(userId, saved.proposal);
      if (!applied)
        return json(409, "Tu CV cambió: pedí las propuestas de nuevo para esta oferta.");
      return fileResponse(applied.document, data.title, data.company, opts.format, true);
    }
    if (opts.proposalRaw !== null) {
      let proposal: unknown = null;
      try {
        proposal = JSON.parse(opts.proposalRaw);
      } catch {
        proposal = null;
      }
      const applied = proposal ? await applyCvTailorProposal(userId, proposal) : null;
      if (applied)
        return fileResponse(applied.document, data.title, data.company, opts.format, true);
    }
    const doc = await buildUserCv(
      userId,
      parseCvOptions({ lang: undefined, email: undefined, basicas: undefined }),
    );
    if (!doc) return json(404, "Completá tu perfil para armar el CV.");
    return fileResponse(
      reorderCvBullets(doc, data.offerSkills),
      data.title,
      data.company,
      opts.format,
      false,
    );
  } catch {
    return json(500, "No pudimos armar tu CV. Probá de nuevo en un rato.");
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const sp = new URL(request.url).searchParams;
  return build(params, {
    proposalRaw: null,
    format: sp.get("formato") === "pdf" ? "pdf" : "docx",
    version: sp.get("version") === "adaptada" ? "adaptada" : "base",
  });
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
  return build(params, { proposalRaw: raw, format: "docx", version: "base" });
}
