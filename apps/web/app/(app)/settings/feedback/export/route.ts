import { feedbackCsv, filterFeedback, parseFeedbackFilters } from "@job-search-os/pipeline";
import { getFeedbackTriage } from "@/lib/feedback-triage";
import { requireUserId } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * CSV del triage del feedback (C8-17) con los mismos filtros que la página. Solo admins con
 * `FEEDBACK_TRIAGE_ENABLED=1`; para el resto, 404. Celdas sin fórmulas de planilla y sin emails.
 */
export async function GET(request: Request): Promise<Response> {
  const userId = await requireUserId();
  const result = await getFeedbackTriage(userId);
  if (!result.ok) return new Response("No encontrado", { status: 404 });
  const params = Object.fromEntries(new URL(request.url).searchParams.entries());
  const rows = filterFeedback(result.rows, parseFeedbackFilters(params));
  return new Response(feedbackCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="feedback-beta.csv"',
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}
