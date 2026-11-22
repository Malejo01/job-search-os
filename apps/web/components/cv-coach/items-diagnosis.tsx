import {
  CV_COACH_PAGES,
  diagnoseCv,
  type CvDiagnosisLevel,
  type CvDocument,
} from "@job-search-os/pipeline";
import Link from "next/link";
import { ContextHelp } from "@/components/context-help";
import { Badge, buttonClasses, cardClasses } from "@/components/ui";
import { CV_DIAGNOSIS_TITLE, CV_LEVEL_WORDS } from "@/lib/textos-rediseno";

const LABELS = {
  structure: "Estructura",
  keywords: "Palabras clave de tu carrera",
  readability: "Legibilidad y largo",
  achievements: "Logros medibles",
  sections: "Secciones profesionales",
} as const;

const TONES: Record<CvDiagnosisLevel, "success" | "warning" | "danger"> = {
  good: "success",
  improvable: "warning",
  missing: "danger",
};

const BAR: Record<CvDiagnosisLevel, string> = {
  good: "bg-success",
  improvable: "bg-warning",
  missing: "bg-danger",
};

const scoreText = (n: number) => n.toFixed(1).replace(".", ",");

/**
 * Diagnóstico del CV por ítems (Server Component, sin consultas nuevas: usa el CV que la página ya armó).
 * Estructura, secciones y legibilidad salen del código; palabras clave y logros medibles dependen del
 * diagnóstico del coach, que corre bajo demanda, así que acá dicen «Pronto». Con el coach activo, «Optimizar
 * mi CV» lleva a él.
 */
export function CvItemsDiagnosis({ doc, coach }: { doc: CvDocument; coach: boolean }) {
  const items = diagnoseCv(doc);
  return (
    <section
      aria-labelledby="cv-diagnostico"
      data-testid="cv-diagnosis"
      className={cardClasses({ padding: "md", className: "no-print flex flex-col gap-4" })}
    >
      <div className="flex flex-wrap items-center gap-1">
        <h2 id="cv-diagnostico" className="text-base font-bold text-fg">
          {CV_DIAGNOSIS_TITLE}
        </h2>
        <ContextHelp slug="filtro-ats" term="filtro ATS" />
      </div>
      <ul className="flex flex-col gap-4">
        {items.map((item) => (
          <li key={item.id} className="flex flex-col gap-1.5" data-testid={`cv-diag-${item.id}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex items-center gap-1 text-sm font-semibold text-fg">
                {LABELS[item.id]}
                {item.id === "keywords" ? (
                  <ContextHelp slug="palabras-clave" term="palabras clave" />
                ) : null}
              </span>
              {item.status === "scored" ? (
                <span className="text-sm font-bold text-fg">
                  {scoreText(item.score)}
                  <span className="text-fg-subtle"> / 10</span>
                </span>
              ) : (
                <Badge tone="neutral">Pronto</Badge>
              )}
            </div>
            {item.status === "scored" ? (
              <>
                <div
                  role="img"
                  aria-label={`${LABELS[item.id]}: ${scoreText(item.score)} de 10`}
                  className="h-2 w-full overflow-hidden rounded-full bg-surface-muted"
                >
                  <div
                    className={`h-full rounded-full ${BAR[item.level]}`}
                    style={{ width: `${item.score * 10}%` }}
                  />
                </div>
                <div className="flex flex-wrap items-start gap-2">
                  <Badge tone={TONES[item.level]}>{CV_LEVEL_WORDS[item.level]}</Badge>
                  <p className="min-w-0 flex-1 text-sm text-fg-muted">{item.advice}</p>
                </div>
              </>
            ) : (
              <p className="text-sm text-fg-muted">
                Todavía no lo medimos acá: lo vas a ver en cuanto esté listo.
              </p>
            )}
          </li>
        ))}
      </ul>
      {coach ? (
        <Link
          href={CV_COACH_PAGES.diagnosis}
          className={buttonClasses({ className: "self-start" })}
          data-testid="cv-optimize"
        >
          Optimizar mi CV
        </Link>
      ) : null}
    </section>
  );
}
