"use client";

import {
  ATS_DISCLAIMER,
  ATS_TITLE,
  checkCvAts,
  type AtsReport,
  type AtsSkill,
  type AtsStatus,
} from "@job-search-os/pipeline";
import { createContext, useContext, useState, type ReactNode } from "react";
import { buttonClasses, cardClasses } from "@/components/ui";

/**
 * «¿Tu CV es legible por los filtros (ATS)?» (R14-2). El veredicto se calcula en este navegador, con el texto
 * que la persona ya tiene en el cuadro: no se manda nada nuevo al servidor, no se guarda ni el CV ni el
 * resultado (vive solo en el estado de esta pantalla) y no se registra ninguna métrica con texto. Las skills de
 * la carrera objetivo llegan desde la página por contexto (catálogo público, no el CV).
 */
const SkillsContext = createContext<readonly AtsSkill[]>([]);

export function AtsSkillsProvider({
  skills,
  children,
}: {
  skills: readonly AtsSkill[];
  children: ReactNode;
}) {
  return <SkillsContext.Provider value={skills}>{children}</SkillsContext.Provider>;
}

const STATUS_LABEL: Record<AtsStatus, string> = {
  ok: "Bien",
  fix: "Para corregir",
  bad: "Importante",
};

const VERDICT_TONE: Record<AtsReport["verdict"], string> = {
  legible: "border-line text-fg",
  legible_con_arreglos: "border-line-ink text-fg",
  dificil: "border-line-ink text-fg",
};

/** Huella corta del texto (no reversible, no se muestra): sirve solo para saber si el texto cambió. */
function stampOf(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return `${text.length}:${h}`;
}

export function AtsCheck({ text }: { text: string }) {
  const skills = useContext(SkillsContext);
  const [result, setResult] = useState<{ stamp: string; report: AtsReport | null } | null>(null);

  function run() {
    const r = checkCvAts(text, skills);
    setResult({ stamp: stampOf(text), report: r.ok ? r.value : null });
  }

  // Si la persona cambia el texto, el resultado anterior ya no vale
  const current = result && result.stamp === stampOf(text) ? result : null;
  const report = current?.report ?? null;
  const failed = current !== null && current.report === null;

  return (
    <section aria-label={ATS_TITLE} data-testid="ats-check" className="flex flex-col gap-2">
      <div>
        <button
          type="button"
          data-testid="ats-check-run"
          onClick={run}
          className={buttonClasses({ variant: "secondary" })}
        >
          Revisar si mi CV es legible por los filtros
        </button>
      </div>
      {failed ? (
        <p role="alert" className="text-sm text-fg">
          El texto es demasiado largo para revisarlo acá. Probá con la parte principal de tu CV.
        </p>
      ) : null}
      {report ? (
        <div
          role="status"
          data-testid="ats-report"
          className={cardClasses({
            padding: "md",
            surface: "none",
            className: `flex flex-col gap-3 ${VERDICT_TONE[report.verdict]}`,
          })}
        >
          <h2 className="text-base font-bold text-fg">{ATS_TITLE}</h2>
          <p className="text-sm text-fg">
            Resultado:{" "}
            <strong data-testid="ats-verdict" data-verdict={report.verdict}>
              {report.label}
            </strong>
          </p>
          <ul className="flex flex-col gap-2">
            {report.points.map((p) => (
              <li key={p.id} data-testid="ats-point" data-status={p.status} className="text-sm">
                <span className="font-semibold text-fg">{STATUS_LABEL[p.status]}: </span>
                <span className="text-fg">{p.what}</span>
                {p.how ? (
                  <span className="block text-fg-muted">Cómo arreglarlo: {p.how}</span>
                ) : null}
              </li>
            ))}
          </ul>
          <p className="text-xs text-fg-muted">
            {ATS_DISCLAIMER} El resultado no se guarda: se calcula acá, en tu navegador.
          </p>
        </div>
      ) : null}
    </section>
  );
}
