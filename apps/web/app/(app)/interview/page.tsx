import Link from "next/link";
import { ContextHelp } from "@/components/context-help";
import { Card, EmptyState, textLinkClasses } from "@/components/ui";
import { AYUDAS_ACADEMY } from "@/lib/textos-rediseno";
import { requireActiveUserId } from "@/lib/session";
import { DeleteSessionButton } from "./delete-session-button";
import { ProgressTable } from "./progress-table";
import { loadStartData } from "./server";
import { StartForm } from "./start-form";

export const metadata = { title: "Interview" };
export const dynamic = "force-dynamic";

const dateFormat = new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "short" });

/**
 * Interview: practicar una entrevista con cinco preguntas y una devolución por cada respuesta. Server
 * Component: arma los datos de la persona (RLS) y deja el formulario de inicio y el borrado en componentes de
 * cliente. Los «?» son Server Components: se pasan al formulario como elementos ya armados.
 */
export default async function InterviewPage() {
  const userId = await requireActiveUserId();
  const data = await loadStartData(userId);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <div className="flex flex-col gap-2">
        <h1 className="text-title font-bold">Interview</h1>
        <p className="text-fg-muted">
          Practicá una entrevista: son 5 preguntas y, por cada respuesta, te mostramos qué tan
          clara, relevante y estructurada (método STAR
          <ContextHelp
            slug={AYUDAS_ACADEMY.star.slug}
            term={AYUDAS_ACADEMY.star.term}
            desde="interview"
          />
          ) estuvo, con un consejo y un ejemplo para mejorarla. Podés hacer hasta {data.max}{" "}
          simulaciones por día.
        </p>
      </div>

      <StartForm
        offers={data.offers}
        suggestedCareer={data.suggestedCareer}
        left={data.left}
        seniorityHelp={
          <ContextHelp
            slug={AYUDAS_ACADEMY.seniority.slug}
            term={AYUDAS_ACADEMY.seniority.term}
            desde="interview"
          />
        }
      />

      <section aria-labelledby="interview-historial" className="flex flex-col gap-3">
        <h2
          id="interview-historial"
          tabIndex={-1}
          className="text-lg font-extrabold focus:outline-none"
        >
          Tus simulaciones
        </h2>
        <ProgressTable progress={data.progress} />
        {data.sessions.length === 0 ? (
          <EmptyState variant="boxed" title="Todavía no hiciste ninguna" action={null}>
            Cuando termines una, la vas a poder repasar desde acá. Para empezar, elegí sobre qué
            practicar en la tarjeta de arriba.
          </EmptyState>
        ) : (
          <ul className="flex flex-col gap-3" data-testid="interview-history">
            {data.sessions.map((s) => (
              <Card as="li" key={s.id} level="list" padding="md" className="flex flex-col gap-1">
                <p className="text-base font-bold text-fg">{s.title}</p>
                <p className="text-sm text-fg-muted">
                  {dateFormat.format(s.createdAt)} ·{" "}
                  {s.status === "terminada"
                    ? "Terminada"
                    : `En curso: ${s.answered} de 5 respondidas`}
                </p>
                <div className="flex flex-wrap items-start gap-3">
                  <Link href={`/interview/${s.id}`} className={textLinkClasses({ block: true })}>
                    {s.status === "terminada" ? "Ver resumen" : "Seguir practicando"}
                  </Link>
                  <DeleteSessionButton sessionId={s.id} title={s.title} />
                </div>
              </Card>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
