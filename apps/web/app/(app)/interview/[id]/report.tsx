import type { InterviewReport } from "@job-search-os/pipeline";
import { Card } from "@/components/ui";
import { CRITERIA, REPORT_PATTERNS, formatAverage, scoreWord } from "../copy";

const PRINT_CSS = `
@media print {
  body:has(.interview-report) header,
  body:has(.interview-report) footer,
  body:has(.interview-report) nav,
  body:has(.interview-report) .no-print { display: none !important; }
  body:has(.interview-report) main { max-width: none !important; padding: 0 !important; }
  .interview-report, .interview-report * {
    background: #ffffff !important;
    color: #18181b !important;
    box-shadow: none !important;
  }
  .interview-report .print-card { border: 1px solid #a1a1aa !important; break-inside: avoid; }
}
`;

type Pick = { position: number; average: number };

function PickCard({
  title,
  pick,
  question,
  testId,
}: {
  title: string;
  pick: Pick;
  question: string | undefined;
  testId: string;
}) {
  return (
    <Card
      as="div"
      level="list"
      padding="md"
      className="print-card flex flex-col gap-1"
      data-testid={testId}
    >
      <h3 className="text-[13px] font-extrabold text-fg-muted">{title}</h3>
      <p className="text-base font-bold text-fg">
        Pregunta {pick.position + 1} · {formatAverage(pick.average)} de 10
      </p>
      {question ? <p className="text-sm text-fg-muted">{question}</p> : null}
    </Card>
  );
}

/**
 * Informe de cierre de la simulación: promedios por criterio, la mejor y la más floja respuesta, y los consejos
 * más repetidos. Solo muestra lo que calculó `buildInterviewReport`; no tiene estado, así que no necesita
 * ser un Client Component por sí mismo. Imprimible: ver `PRINT_CSS`.
 */
export function InterviewReportView({
  report,
  questions,
}: {
  report: InterviewReport;
  questions: string[];
}) {
  return (
    <div className="interview-report flex flex-col gap-4" data-testid="interview-report">
      <style>{PRINT_CSS}</style>

      <section aria-labelledby="informe-promedios" className="flex flex-col gap-2">
        <h2 id="informe-promedios" className="text-lg font-extrabold text-fg">
          Tu promedio por criterio
        </h2>
        <dl className="grid gap-3 sm:grid-cols-3" data-testid="interview-report-averages">
          {CRITERIA.map(({ key, label }) => (
            <div key={key} className="print-card rounded-control bg-surface-muted p-3">
              <dt className="text-[13px] font-extrabold text-fg-muted">{label}</dt>
              <dd className="mt-1 flex items-baseline gap-2">
                <span className="text-2xl font-extrabold text-fg">
                  {formatAverage(report.averages[key].value)}
                </span>
                <span className="text-sm font-semibold text-fg-muted">
                  de 10 · {scoreWord(report.averages[key].level)}
                </span>
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="informe-extremos" className="flex flex-col gap-2">
        <h2 id="informe-extremos" className="text-lg font-extrabold text-fg">
          Tu mejor respuesta y la que más puede mejorar
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <PickCard
            title="La mejor"
            pick={report.best}
            question={questions[report.best.position]}
            testId="interview-report-best"
          />
          {report.worst ? (
            <PickCard
              title="La que más puede mejorar"
              pick={report.worst}
              question={questions[report.worst.position]}
              testId="interview-report-worst"
            />
          ) : null}
        </div>
      </section>

      <section aria-labelledby="informe-consejos" className="flex flex-col gap-2">
        <h2 id="informe-consejos" className="text-lg font-extrabold text-fg">
          Lo que más se repitió
        </h2>
        <div className="flex flex-col gap-3" data-testid="interview-report-tips">
          {report.tipGroups.map((g) => (
            <Card
              as="div"
              key={g.code}
              level="list"
              padding="md"
              className="print-card flex flex-col gap-1"
            >
              <p className="text-[13px] font-extrabold text-fg-muted">
                {CRITERIA.find((c) => c.key === g.code)?.label} · en {g.count}{" "}
                {g.count === 1 ? "respuesta" : "respuestas"}
              </p>
              <p className="text-base text-fg">{REPORT_PATTERNS[g.code]}</p>
              <p className="text-base text-fg">
                <span className="font-bold">Consejo: </span>
                {g.tip}
              </p>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}
