import {
  CV_COACH_PAGES,
  cvDiagnosisMainFix,
  diagnoseCv,
  type CvDiagnosisLevel,
  type CvDocument,
  type KeywordMarket,
} from "@job-search-os/pipeline";
import Link from "next/link";
import { AfiDice } from "@/components/afi-dice";
import { ContextHelp } from "@/components/context-help";
import { InfoTip } from "@/components/cv-coach/info-tip";
import { Badge, buttonClasses, cardClasses } from "@/components/ui";
import { fixHref } from "@/lib/cv-tu-cv";
import {
  AFI_DICE,
  AYUDAS_ACADEMY,
  CV_CALIDAD_TEXTOS,
  CV_DIAGNOSIS_TITLE,
  CV_LEVEL_WORDS,
  CV_NOT_ENOUGH_DATA_LABEL,
} from "@/lib/textos-rediseno";

const T = CV_CALIDAD_TEXTOS.diagnostico;

const TONES: Record<CvDiagnosisLevel, "success" | "warning" | "danger" | "neutral"> = {
  good: "success",
  improvable: "warning",
  missing: "danger",
  empty: "neutral",
};

const BAR: Record<CvDiagnosisLevel, string> = {
  good: "bg-success",
  improvable: "bg-warning",
  missing: "bg-danger",
  empty: "bg-surface-muted",
};

const LEVELS: CvDiagnosisLevel[] = ["good", "improvable", "missing", "empty"];

/**
 * Diagnóstico del CV por ítems (Server Component, sin consultas nuevas: usa el CV que la página ya armó).
 * R33-06: palabra y número entero («Sólido · 9/10»), qué mide cada barra con su ⓘ, legibilidad y largo por
 * separado y cada «falta» con su botón al paso concreto. Si varias barras esperan por lo mismo (no hay
 * experiencia), una sola acción principal y el resto en pausa. Sin mercado, las palabras clave dicen
 * «Pronto». Con el coach activo, «Optimizar mi CV» lleva a él.
 */
export function CvItemsDiagnosis({
  doc,
  coach,
  keywordMarket = null,
  chatVisible = false,
}: {
  doc: CvDocument;
  coach: boolean;
  /** Mercado del puesto principal (R20-01): sin él, las palabras clave dicen «Pronto». */
  keywordMarket?: KeywordMarket | null;
  /** El chat de `/cv/armar` está abierto para la persona: de eso depende a dónde lleva cada botón. */
  chatVisible?: boolean;
}) {
  const items = diagnoseCv(doc, { keywords: keywordMarket });
  const mainFix = cvDiagnosisMainFix(items);
  const mainHref = mainFix ? fixHref(mainFix, { chatVisible }) : null;
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
        <ContextHelp slug={AYUDAS_ACADEMY.ats.slug} term={AYUDAS_ACADEMY.ats.term} desde="cv" />
      </div>
      {/* R28-15: Afi presenta la sección con una burbuja */}
      <AfiDice pose="explicando" texto={AFI_DICE.cvDiagnostico} testId="afi-dice-cv-diagnostico" />
      {/* C-37: lo que miden los niveles, y qué significa cada palabra */}
      <p className="text-sm text-fg" data-testid="cv-diag-frase">
        {T.frase}
      </p>
      <ul
        className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-fg-muted"
        data-testid="cv-diag-leyenda"
      >
        {LEVELS.map((l) => (
          <li key={l}>
            <strong className="text-fg">{CV_LEVEL_WORDS[l]}</strong>: {T.significados[l]}
          </li>
        ))}
      </ul>

      {mainFix ? (
        <div
          data-testid="cv-diag-principal"
          className={cardClasses({
            tone: "warning",
            padding: "md",
            className: "flex flex-col gap-2",
          })}
        >
          <h3 className="text-base font-bold text-warning">{T.principalTitulo}</h3>
          <p className="text-sm text-warning">{T.principalTexto}</p>
          {mainHref ? (
            <Link href={mainHref} className={buttonClasses({ className: "self-start" })}>
              {T.pasos[mainFix]}
            </Link>
          ) : null}
        </div>
      ) : null}

      <ul className="flex flex-col gap-4">
        {items.map((item) => (
          <li key={item.id} className="flex flex-col gap-1.5" data-testid={`cv-diag-${item.id}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex items-center gap-1 text-sm font-semibold text-fg">
                {T.labels[item.id]}
                <InfoTip term={T.labels[item.id]} testId={`cv-diag-mide-${item.id}`}>
                  {T.mide[item.id]}
                </InfoTip>
                {item.id === "keywords" ? (
                  <ContextHelp
                    slug={AYUDAS_ACADEMY.palabrasClave.slug}
                    term={AYUDAS_ACADEMY.palabrasClave.term}
                    desde="cv"
                  />
                ) : null}
                {item.id === "achievements" ? (
                  <ContextHelp
                    slug={AYUDAS_ACADEMY.logros.slug}
                    term={AYUDAS_ACADEMY.logros.term}
                    desde="cv"
                  />
                ) : null}
              </span>
              {item.status === "scored" ? (
                <span className="flex items-center gap-2 text-sm font-bold text-fg">
                  <Badge tone={TONES[item.level]}>{CV_LEVEL_WORDS[item.level]}</Badge>
                  <span data-testid={`cv-diag-score-${item.id}`}>
                    {item.score}
                    <span className="text-fg-subtle">/10</span>
                  </span>
                </span>
              ) : item.status === "no_data" ? (
                <Badge tone="neutral">{CV_NOT_ENOUGH_DATA_LABEL}</Badge>
              ) : item.status === "waiting" ? (
                <Badge tone="neutral">En pausa</Badge>
              ) : (
                <Badge tone="neutral">Pronto</Badge>
              )}
            </div>
            {item.status === "scored" ? (
              <>
                <div
                  role="img"
                  aria-label={`${T.labels[item.id]}: ${CV_LEVEL_WORDS[item.level]}, ${item.score} de 10`}
                  className="h-2 w-full overflow-hidden rounded-full bg-surface-muted"
                >
                  <div
                    className={`h-full rounded-full ${BAR[item.level]}`}
                    style={{ width: `${item.score * 10}%` }}
                  />
                </div>
                <p className="min-w-0 text-sm text-fg-muted">{item.advice}</p>
                {/* Un solo botón principal por lo mismo: el que ya está arriba no se repite acá */}
                {item.fixes
                  .filter((f) => f !== mainFix)
                  .map((f) => ({ f, href: fixHref(f, { chatVisible }) }))
                  .filter((x) => x.href !== null)
                  .slice(0, 2)
                  .map(({ f, href }) => (
                    <Link
                      key={f}
                      href={href!}
                      data-testid={`cv-diag-paso-${item.id}-${f}`}
                      className={buttonClasses({ variant: "secondary", className: "self-start" })}
                    >
                      {T.pasos[f]}
                    </Link>
                  ))}
              </>
            ) : item.status === "no_data" ? (
              <p className="text-sm text-fg-muted">
                Todavía hay pocos avisos de tu puesto para comparar: no te ponemos un puntaje que no
                podamos sostener.
              </p>
            ) : item.status === "waiting" ? (
              <p className="text-sm text-fg-muted">{T.enPausa}</p>
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
