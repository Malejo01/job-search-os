import {
  FEEDBACK_CATEGORY_LABELS,
  FEEDBACK_STATUSES,
  FEEDBACK_STATUS_LABELS,
  REPORT_STATUS_LABELS,
  isFeedbackCategory,
  purgedNote,
  type FeedbackStatus,
} from "@job-search-os/pipeline";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { buttonClasses } from "@/components/ui";
import { requireAdminOr404 } from "@/lib/admin-guard";
import { getFeedbackReport, listDeletedAttachments } from "@/lib/admin-feedback-reports";
import { isUuid } from "@/lib/feedback-files";
import { requireUserId } from "@/lib/session";
import { purgeItemAttachmentsAction, setReportItemStatusAction } from "../actions";

export const metadata: Metadata = { title: "Informe de revisión", robots: { index: false } };
export const dynamic = "force-dynamic";

const DATE = new Intl.DateTimeFormat("es-AR", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "America/Argentina/Buenos_Aires",
});

const STATUS_TONE: Record<FeedbackStatus, string> = {
  nuevo: "bg-warning-soft text-warning",
  visto: "bg-info-soft text-info",
  resuelto: "bg-success-soft text-success",
};

const KB = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/**
 * Un informe de revisión (R29-05): sus ítems en orden con la pantalla, el texto (siempre como texto, nunca como
 * HTML), las capturas en miniatura que se abren grandes, los documentos para descargar y el estado de cada ítem.
 * Los archivos salen de `/api/feedback-files/<id>`, con sesión y sin URL pública.
 */
export default async function ReportDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId();
  await requireAdminOr404(userId);
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const result = await getFeedbackReport(userId, id.toLowerCase());
  if (!result.ok && result.reason !== "sin_datos") notFound();

  if (!result.ok) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <p role="status" className="rounded-card bg-surface p-4 text-sm">
          No se pudo leer el informe. Probá de nuevo en un rato.
        </p>
        <Link href="/admin/informes" className="text-sm underline">
          Volver a los informes
        </Link>
      </div>
    );
  }
  const report = result.report;
  const deleted = await listDeletedAttachments(userId, report.id);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Link
          href="/admin/informes"
          className="inline-flex min-h-11 items-center text-sm underline"
        >
          Volver a los informes
        </Link>
        <h1 className="text-title font-bold">Informe de la persona {report.person}</h1>
        <p className="text-sm text-fg-muted">
          {REPORT_STATUS_LABELS[report.status]}
          {report.sentAt ? ` · enviado ${DATE.format(report.sentAt)}` : ""} · {report.items.length}{" "}
          {report.items.length === 1 ? "ítem" : "ítems"}
        </p>
        <div>
          <a
            href={`/admin/informes/${report.id}/export`}
            data-testid="informe-exportar"
            className={buttonClasses({ variant: "secondary", size: "sm", className: "min-h-11" })}
          >
            Exportar para Claude (.md)
          </a>
        </div>
      </div>

      <ol data-testid="informe-items" className="m-0 flex list-none flex-col gap-4 p-0">
        {report.items.map((item) => {
          const images = item.attachments.filter((a) => a.kind === "image");
          const docs = item.attachments.filter((a) => a.kind !== "image");
          return (
            <li
              key={item.id}
              data-testid="informe-item"
              className="flex flex-col gap-3 rounded-card bg-surface p-4 text-sm"
            >
              <div className="flex flex-wrap items-center gap-2 text-xs text-fg-subtle">
                <span className="font-bold text-fg">Ítem {item.position + 1}</span>
                <span className={`rounded-badge px-2 py-0.5 font-bold ${STATUS_TONE[item.status]}`}>
                  {FEEDBACK_STATUS_LABELS[item.status]}
                </span>
                <code>{item.path}</code>
                <span>·</span>
                <span>
                  {isFeedbackCategory(item.category)
                    ? FEEDBACK_CATEGORY_LABELS[item.category]
                    : item.category}
                </span>
              </div>

              <p className="whitespace-pre-wrap break-words text-fg" data-testid="informe-mensaje">
                {item.message}
              </p>

              {images.length > 0 ? (
                <ul
                  className="m-0 flex list-none flex-wrap gap-2 p-0"
                  data-testid="informe-capturas"
                >
                  {images.map((a) => (
                    <li key={a.id}>
                      <a
                        href={`/api/feedback-files/${a.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`Abrir la captura ${a.name} en grande`}
                        className="block min-h-11 min-w-11 overflow-hidden rounded-control border border-line focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
                      >
                        {/* Miniatura de un archivo con sesión (no es una imagen estática): sin next/image */}
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={`/api/feedback-files/${a.id}`}
                          alt={`Captura ${a.name}`}
                          width={160}
                          height={120}
                          loading="lazy"
                          className="h-[120px] w-[160px] object-cover"
                        />
                      </a>
                    </li>
                  ))}
                </ul>
              ) : null}

              {docs.length > 0 ? (
                <ul
                  className="m-0 flex list-none flex-col gap-1 p-0"
                  data-testid="informe-documentos"
                >
                  {docs.map((a) => (
                    <li key={a.id}>
                      <a
                        href={`/api/feedback-files/${a.id}`}
                        download
                        className="inline-flex min-h-11 items-center gap-2 font-semibold text-link underline"
                      >
                        {a.name}
                        <span className="text-xs font-normal text-fg-subtle">
                          ({a.kind === "pdf" ? "PDF" : "Word"}, {KB(a.bytes)})
                        </span>
                      </a>
                    </li>
                  ))}
                </ul>
              ) : null}

              {deleted.filter((d) => d.itemId === item.id).length > 0 ? (
                <ul
                  className="m-0 flex list-none flex-col gap-1 p-0 text-xs text-fg-muted"
                  data-testid="informe-borrados"
                >
                  {deleted
                    .filter((d) => d.itemId === item.id)
                    .map((d, i) => (
                      <li key={`${d.name}-${i}`}>{purgedNote(d)}</li>
                    ))}
                </ul>
              ) : null}

              {item.status === "resuelto" && item.attachments.length > 0 ? (
                <details data-testid="informe-purga-item">
                  <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm font-semibold underline">
                    Borrar sus adjuntos
                  </summary>
                  <form action={purgeItemAttachmentsAction} className="mt-2 flex flex-col gap-2">
                    <input type="hidden" name="itemId" value={item.id} />
                    <input type="hidden" name="reportId" value={report.id} />
                    <p>
                      Se van a borrar {item.attachments.length}{" "}
                      {item.attachments.length === 1 ? "archivo" : "archivos"} (
                      {KB(item.attachments.reduce((n, a) => n + a.bytes, 0))}). El texto del ítem se
                      queda. Esto no se puede deshacer.
                    </p>
                    <div>
                      <button
                        type="submit"
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

              <div className="flex flex-wrap gap-2">
                {FEEDBACK_STATUSES.filter((st) => st !== item.status).map((st) => (
                  <form key={st} action={setReportItemStatusAction}>
                    <input type="hidden" name="itemId" value={item.id} />
                    <input type="hidden" name="reportId" value={report.id} />
                    <input type="hidden" name="status" value={st} />
                    <button
                      type="submit"
                      className={buttonClasses({
                        variant: "secondary",
                        size: "sm",
                        className: "min-h-11",
                      })}
                    >
                      Marcar como {FEEDBACK_STATUS_LABELS[st].toLowerCase()}
                    </button>
                  </form>
                ))}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
