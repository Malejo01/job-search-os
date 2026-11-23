import { buildCvDocx, cvOfferFileName, reorderCvBullets } from "@job-search-os/pipeline";
import { isUuid } from "@/lib/ids";
import { buildUserCv, parseCvOptions } from "@/lib/cv-source";
import { sessionUserId } from "@/lib/session";
import { getPostularData } from "../data";

export const dynamic = "force-dynamic";

function json(status: number, error: string): Response {
  return Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * Descarga del CV para esta oferta (R20-05). El usuario sale de la sesión, nunca de un parámetro, y la
 * oferta tiene que ser suya (`getPostularData` filtra por persona con RLS). El archivo se arma en memoria
 * y se responde directo: no se guarda en ningún lado. Hoy sale el CV confirmado con las viñetas
 * reordenadas por coincidencia con la oferta, sin reescribir ninguna.
 *
 * Enganche de R20-04 (`CV_TAILOR`): cuando esté prendido, acá se reemplaza `reordered` por el
 * `CvDocument` de la versión adaptada y verificada, antes de `buildCvDocx`.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const userId = await sessionUserId();
  if (!userId) return json(401, "Iniciá sesión para descargar tu CV.");
  const { id } = await params;
  if (!isUuid(id)) return json(404, "No encontramos esa oferta.");
  let bytes: Uint8Array;
  let fileName: string;
  try {
    const data = await getPostularData(userId, id);
    if (!data) return json(404, "No encontramos esa oferta.");
    const doc = await buildUserCv(
      userId,
      parseCvOptions({ lang: undefined, email: undefined, basicas: undefined }),
    );
    if (!doc) return json(404, "Completá tu perfil para armar el CV.");
    const reordered = reorderCvBullets(doc, data.offerSkills);
    bytes = buildCvDocx(reordered);
    fileName = cvOfferFileName(data.title, data.company);
  } catch {
    return json(500, "No pudimos armar tu CV. Probá de nuevo en un rato.");
  }
  return new Response(bytes.slice().buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
