import Link from "next/link";
import { notFound } from "next/navigation";
import { REPORT_STATUS_LABELS, summarizeReport } from "@job-search-os/pipeline";
import { AfiDice } from "@/components/afi-dice";
import { textLinkClasses } from "@/components/ui";
import { loadDraft, loadSentReports } from "@/lib/feedback-report";
import { canViewRecorrido } from "@/lib/recorrido-access";
import { RECORRIDO_SCREENS } from "@/lib/recorrido";
import { requireUserId } from "@/lib/session";
import { INFORME_TEXTOS as T, llenarTexto } from "@/lib/textos-rediseno";
import { voiceServerAllowedFor } from "@/lib/voice/server";
import { InformeEditor } from "./informe-editor";
import type { ScreenOption } from "./informe-item";

export const metadata = { title: T.title, robots: { index: false } };
export const dynamic = "force-dynamic";

/** Las pantallas del recorrido, una sola vez por ruta (varias comparten `/jobs/[id]`), más «toda la app». */
function screenOptions(): ScreenOption[] {
  const byRoute = new Map<string, string[]>();
  for (const s of RECORRIDO_SCREENS) {
    const titles = byRoute.get(s.route) ?? [];
    titles.push(s.title);
    byRoute.set(s.route, titles);
  }
  return [
    { route: "/", label: T.screenGeneral },
    ...[...byRoute].map(([route, titles]) => ({ route, label: titles.join(" / ") })),
  ];
}

const fecha = (d: Date) =>
  new Intl.DateTimeFormat("es-AR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(d);

/**
 * «Mi informe de revisión» (R29-03): el informe largo de testers y admins. Solo ellos (`canViewRecorrido`, mismo
 * criterio que `/recorrido`): el resto recibe el 404, comprobado en el servidor antes de leer nada. El borrador
 * se lee con la sesión (RLS) y llega al editor ya con sus ítems y adjuntos; el editor es el único Client Component
 * pesado. Los informes ya enviados se listan abajo, de solo lectura.
 */
export default async function InformePage() {
  const userId = await requireUserId();
  if (!(await canViewRecorrido(userId))) notFound();
  const [draft, sent, serverTranscribe] = await Promise.all([
    loadDraft(userId),
    loadSentReports(userId),
    voiceServerAllowedFor(userId).catch(() => false),
  ]);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <div className="flex flex-col gap-2">
        <h1 className="text-title font-bold">{T.title}</h1>
        <p className="text-fg-muted">{T.intro}</p>
        <Link href="/recorrido" className={textLinkClasses({ block: true, className: "text-sm" })}>
          Volver al recorrido
        </Link>
      </div>

      <InformeEditor
        initialItems={(draft?.items ?? []).map((i) => ({
          id: i.id,
          path: i.path,
          category: i.category,
          message: i.message,
          attachments: i.attachments,
        }))}
        screens={screenOptions()}
        serverTranscribe={serverTranscribe}
        intro={<AfiDice pose="explicando" texto={T.afiExplicando} testId="informe-afi" />}
        sentAfi={<AfiDice pose="motivacion" texto={T.afiEnviado} testId="informe-afi-enviado" />}
      />

      {sent.length > 0 ? (
        <section aria-labelledby="informe-enviados" className="flex flex-col gap-2">
          <h2 id="informe-enviados" className="text-heading font-bold">
            {T.sentListTitle}
          </h2>
          <ul
            data-testid="informe-lista-enviados"
            className="m-0 flex list-none flex-col gap-2 p-0"
          >
            {sent.map((r) => (
              <li key={r.id} className="rounded-control border border-line-control p-3 text-sm">
                {llenarTexto(T.sentItem, {
                  fecha: fecha(r.sentAt),
                  resumen: summarizeReport(r),
                })}
                {" · "}
                <span className="font-semibold">{REPORT_STATUS_LABELS[r.status]}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
