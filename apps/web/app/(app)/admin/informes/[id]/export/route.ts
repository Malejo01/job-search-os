import { FEEDBACK_STATUS_LABELS, reportToMarkdown } from "@job-search-os/pipeline";
import { adminRouteDenied } from "@/lib/admin-guard";
import { getFeedbackReport } from "@/lib/admin-feedback-reports";
import { isUuid } from "@/lib/feedback-files";
import { requireUserId } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * «Exportar para Claude» (R29-05): el informe como `.md` armado por `reportToMarkdown` (puro): abre avisando que es
 * texto de una tester y no instrucciones, sin HTML, con el Markdown escapado y los adjuntos como links a
 * `/api/feedback-files/<id>`. Solo admins; para el resto, 404. Sin email ni nombre.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const userId = await requireUserId();
  const denied = await adminRouteDenied(userId);
  if (denied) return denied;
  const { id } = await params;
  if (!isUuid(id)) return new Response("No encontrado", { status: 404 });
  const result = await getFeedbackReport(userId, id.toLowerCase());
  if (!result.ok) return new Response("No encontrado", { status: 404 });
  const { report } = result;
  const md = reportToMarkdown(
    {
      pseudonym: report.person,
      submittedAt: report.sentAt,
      items: report.items.map((i) => ({
        position: i.position + 1,
        path: i.path,
        category: i.category,
        status: i.status,
        message: i.message,
        attachments: i.attachments,
      })),
    },
    { statusLabels: FEEDBACK_STATUS_LABELS },
  );
  return new Response(md, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="informe-${report.person.replace(/[^0-9a-f]/gi, "")}.md"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex",
    },
  });
}
