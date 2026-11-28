import Link from "next/link";
import { notFound } from "next/navigation";
import { buttonClasses } from "@/components/ui";
import { isAdminUser } from "@/lib/admin-guard";
import {
  calibrationAllowedFor,
  loadCalibrationEntries,
  pickCalibrationEntries,
} from "@/lib/calibration";
import { formatScoreNumber } from "@/lib/labels";
import { requireUserId } from "@/lib/session";
import { EVALUACION_TEXTOS, llenarTexto } from "@/lib/textos-rediseno";
import { ProponerPuntaje } from "../jobs/[id]/proponer-puntaje";
import { Verdict } from "../jobs/[id]/verdict";

export const metadata = { title: EVALUACION_TEXTOS.calibracion.titulo, robots: { index: false } };
export const dynamic = "force-dynamic";

const T = EVALUACION_TEXTOS.calibracion;

/**
 * Kit para calibrar la evaluación nueva (R31-10): entre 20 y 30 ofertas de la persona, variadas (carreras,
 * idiomas, con y sin condición excluyente), evaluadas con `evaluate_job@v1.5+`. Cada una con «¿Te sirve esta
 * evaluación?» y «Proponer otro puntaje», que ya guardan en la evaluación. Solo admins y testers, comprobado en el
 * servidor antes de leer nada, y solo con `JOB_CARD` encendida para la persona: si no, 404 (la app se ve igual
 * que al cerrar la R30). Server Component: los formularios son los de siempre.
 */
export default async function CalibracionPage() {
  const userId = await requireUserId();
  if (!(await calibrationAllowedFor(userId))) notFound();

  const picked = pickCalibrationEntries(await loadCalibrationEntries(userId));
  const marked = picked.filter((e) => e.verdict !== null || e.humanScore !== null).length;
  const agree = picked.filter((e) => e.verdict === "de_acuerdo").length;
  const disagree = picked.filter((e) => e.verdict === "en_desacuerdo").length;
  const admin = await isAdminUser(userId);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <div className="flex flex-col gap-2">
        <h1 className="text-title font-bold">{T.titulo}</h1>
        <p className="text-fg-muted">{T.intro}</p>
        <p className="text-sm text-fg-muted">{T.consejoMotivo}</p>
        <details className="rounded-card border border-line p-3 text-sm">
          <summary className="cursor-pointer font-semibold">{T.queMirar}</summary>
          <ul className="mt-2 list-disc pl-5 text-fg-muted">
            {T.queMirarItems.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </details>
        {admin ? (
          <div className="flex flex-col items-start gap-1">
            <a
              href="/admin/calibracion/export"
              download
              data-testid="calibracion-exportar"
              className={buttonClasses({ variant: "secondary" })}
            >
              {T.exportar}
            </a>
            <p className="text-sm text-fg-muted">{T.exportarAyuda}</p>
          </div>
        ) : null}
      </div>

      {picked.length === 0 ? (
        <p
          data-testid="calibracion-vacia"
          className="rounded-card border border-line p-4 text-fg-muted"
        >
          {T.sinOfertas}
        </p>
      ) : (
        <>
          <p role="status" data-testid="calibracion-progreso" className="font-semibold">
            {llenarTexto(T.progreso, { x: marked, y: picked.length })}
            {marked > 0 ? (
              <span className="font-normal text-fg-muted">
                {" "}
                · {llenarTexto(T.resumen, { a: agree, d: disagree })}
              </span>
            ) : null}
          </p>
          <ol className="flex flex-col gap-4">
            {picked.map((e) => (
              <li
                key={e.jobId}
                data-testid="calibracion-oferta"
                className="flex min-w-0 flex-col gap-3 rounded-card bg-surface p-4"
              >
                <div className="flex min-w-0 flex-col gap-1">
                  <h2 className="break-words font-bold">{e.title}</h2>
                  <p className="break-words text-sm text-fg-muted">{e.company}</p>
                  <p className="text-sm">
                    {formatScoreNumber(e.score)}/10 ·{" "}
                    {e.blockers.length > 0
                      ? llenarTexto(T.condiciones, { n: e.blockers.length })
                      : T.sinCondiciones}
                  </p>
                  <Link
                    href={`/jobs/${e.jobId}`}
                    className="inline-flex min-h-11 items-center font-semibold text-link underline underline-offset-2"
                  >
                    {T.abrir}
                  </Link>
                </div>
                <Verdict
                  jobId={e.jobId}
                  evaluationId={e.evaluationId}
                  verdict={e.verdict}
                  note={e.note}
                />
                <ProponerPuntaje
                  jobId={e.jobId}
                  evaluationId={e.evaluationId}
                  score={e.score}
                  humanScore={e.humanScore}
                  humanNote={e.note}
                />
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}
