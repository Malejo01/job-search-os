import Link from "next/link";
import { Card, EmptyState, textLinkClasses } from "@/components/ui";
import { requireActiveUserId } from "@/lib/session";
import { loadStartData } from "./server";
import { StartForm } from "./start-form";

export const metadata = { title: "Interview" };
export const dynamic = "force-dynamic";

const dateFormat = new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "short" });

/**
 * Interview: practicar una entrevista con cinco preguntas y una devolución por cada respuesta. Server
 * Component: arma los datos de la persona (RLS) y deja el formulario de inicio en un componente de cliente.
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
          clara, relevante y estructurada (método STAR) estuvo, con un consejo y un ejemplo para
          mejorarla. Podés hacer hasta {data.max} simulaciones por día.
        </p>
      </div>

      <StartForm offers={data.offers} suggestedCareer={data.suggestedCareer} left={data.left} />

      <section aria-labelledby="interview-historial" className="flex flex-col gap-3">
        <h2 id="interview-historial" className="text-lg font-extrabold">
          Tus simulaciones
        </h2>
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
                <Link href={`/interview/${s.id}`} className={textLinkClasses({ block: true })}>
                  {s.status === "terminada" ? "Ver resumen" : "Seguir practicando"}
                </Link>
              </Card>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
