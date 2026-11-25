import {
  ATTACHMENT_PURGE_DAYS,
  REPORT_STATUS_LABELS,
  type ReportStatus,
} from "@job-search-os/pipeline";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { buttonClasses } from "@/components/ui";
import { requireAdminOr404 } from "@/lib/admin-guard";
import { listFeedbackReports, previewPurgeResolved } from "@/lib/admin-feedback-reports";
import { requireUserId } from "@/lib/session";
import { purgeResolvedAttachmentsAction } from "./actions";

const MB = (bytes: number) => (bytes / (1024 * 1024)).toFixed(1).replace(".", ",");

export const metadata: Metadata = { title: "Informes de revisión", robots: { index: false } };
export const dynamic = "force-dynamic";

const DATE = new Intl.DateTimeFormat("es-AR", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "America/Argentina/Buenos_Aires",
});

const STATUS_TONE: Record<ReportStatus, string> = {
  borrador: "bg-surface-muted text-fg-muted",
  enviado: "bg-warning-soft text-warning",
  visto: "bg-info-soft text-info",
  resuelto: "bg-success-soft text-success",
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Informes de revisión que enviaron las testers (R29-05). Solo admins; sin email ni nombre: cada persona va con
 * su identificador de 6 caracteres. Los borradores no se ven.
 */
export default async function ReportsPage() {
  const userId = await requireUserId();
  await requireAdminOr404(userId);
  const result = await listFeedbackReports(userId);
  if (!result.ok && result.reason === "no_admin") notFound();
  const purge = result.ok ? await previewPurgeResolved(userId) : null;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-title font-bold">Informes de revisión</h1>
        <p className="text-sm text-fg-muted">
          Lo que las testers mandaron con «Mi informe de revisión», del más reciente al más viejo.
          Sin email ni nombre: cada persona tiene un identificador de 6 caracteres.
        </p>
      </div>

      {result.ok && purge ? (
        <details data-testid="purga-panel" className="rounded-card bg-surface p-4 text-sm">
          <summary className="inline-flex min-h-11 cursor-pointer items-center font-semibold underline">
            Borrar adjuntos de lo resuelto ahora
          </summary>
          <form action={purgeResolvedAttachmentsAction} className="mt-2 flex flex-col gap-3">
            <p data-testid="purga-resumen" className="text-fg">
              {purge.files === 0
                ? `No hay adjuntos para borrar: solo se borran los de ítems resueltos hace ${ATTACHMENT_PURGE_DAYS} días o más.`
                : `Se van a borrar ${plural(purge.files, "archivo", "archivos")} (${MB(purge.bytes)} MB) de ítems resueltos hace ${ATTACHMENT_PURGE_DAYS} días o más. El texto de los ítems se queda. Esto no se puede deshacer.`}
            </p>
            <div>
              <button
                type="submit"
                disabled={purge.files === 0}
                className={buttonClasses({
                  variant: "secondary",
                  size: "sm",
                  className: "min-h-11",
                })}
              >
                Sí, borrar para siempre
              </button>
            </div>
          </form>
        </details>
      ) : null}

      {!result.ok ? (
        <p role="status" className="rounded-card bg-surface p-4 text-sm">
          No se pudieron leer los informes (¿falta aplicar la migración 0084 y las políticas 0069 y
          0070?).
        </p>
      ) : result.rows.length === 0 ? (
        <p className="text-sm text-fg-muted">Todavía no llegó ningún informe.</p>
      ) : (
        <ul data-testid="informes-lista" className="m-0 flex list-none flex-col gap-3 p-0">
          {result.rows.map((r) => (
            <li key={r.id} data-testid="informe-fila">
              <Link
                href={`/admin/informes/${r.id}`}
                className="flex flex-col gap-2 rounded-card bg-surface p-4 text-sm hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
              >
                <span className="flex flex-wrap items-center gap-2 text-xs text-fg-subtle">
                  <span className={`rounded-badge px-2 py-0.5 font-bold ${STATUS_TONE[r.status]}`}>
                    {REPORT_STATUS_LABELS[r.status]}
                  </span>
                  <span>{r.sentAt ? DATE.format(r.sentAt) : "sin fecha"}</span>
                  <span>·</span>
                  <span>persona {r.person}</span>
                </span>
                <span className="text-fg">
                  {plural(r.items, "ítem", "ítems")}
                  {" · "}
                  {plural(r.screenshots, "captura", "capturas")}
                  {" · "}
                  {plural(r.documents, "documento", "documentos")}
                </span>
                {r.itemsNew > 0 ? (
                  <span className="text-xs font-semibold text-fg-muted">
                    {r.itemsNew === 1 ? "1 ítem sin ver" : `${r.itemsNew} ítems sin ver`}
                  </span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
