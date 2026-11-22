import Link from "next/link";
import { notFound } from "next/navigation";
import { buttonClasses } from "@/components/ui";
import { isUuid } from "@/lib/ids";
import { requireUserId } from "@/lib/session";
import { getPostularData } from "./data";
import { httpsUrl, postularChecklist } from "./postular-view";

export const dynamic = "force-dynamic";

export const metadata = { title: "Preparar mi postulación" };

/**
 * Preparar mi postulación (R17-06): junta lo que ya existe para esta oferta (respuestas aprobadas,
 * carta si la hay, el CV y una checklist) y termina en un enlace al aviso original. No postula, no
 * llama a ningún modelo y no guarda nada en el sitio de la empresa (ADR-004).
 */
export default async function PostularPage({ params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const data = await getPostularData(userId, id);
  if (!data) notFound();

  const url = httpsUrl(data.url);
  const checklist = postularChecklist({
    hasAnswers: data.answers.length > 0,
    hasCover: data.coverNote !== null,
  });

  return (
    <article className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 pb-28 sm:pt-8 sm:pb-10">
      <div className="flex flex-col gap-1">
        <Link
          href={`/jobs/${data.id}`}
          className="inline-flex min-h-11 w-fit items-center text-sm text-link underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
        >
          ← Volver a la oferta
        </Link>
        <h1 className="text-xl font-semibold">Preparar mi postulación</h1>
        <p className="text-sm text-fg-muted">
          {data.title} · {data.company}
        </p>
        <p className="text-xs text-fg-subtle">
          Acá juntamos lo que ya tenés para esta oferta. Nada se envía desde la app: la postulación
          la hacés vos en el sitio del aviso.
        </p>
      </div>

      <section
        aria-labelledby="postular-respuestas"
        data-testid="postular-respuestas"
        className="rounded-card border border-line p-3 text-sm"
      >
        <h2 id="postular-respuestas" className="font-semibold">
          Tus respuestas
        </h2>
        {data.answers.length ? (
          <dl className="mt-2 flex flex-col gap-3">
            {data.answers.map((qa, i) => (
              <div key={i}>
                <dt className="font-medium text-fg">{qa.question}</dt>
                <dd className="mt-0.5 whitespace-pre-wrap text-fg-muted">{qa.answer}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="mt-1 text-fg-muted">
            Todavía no guardaste respuestas para esta oferta. Si el formulario tiene preguntas,
            pegalas en{" "}
            <Link href={`/jobs/${data.id}`} className="text-link underline underline-offset-2">
              la oferta
            </Link>{" "}
            para armar borradores y aprobarlos.
          </p>
        )}
      </section>

      {data.coverNote ? (
        <section
          aria-labelledby="postular-carta"
          data-testid="postular-carta"
          className="rounded-card border border-line p-3 text-sm"
        >
          <h2 id="postular-carta" className="font-semibold">
            Tu carta
          </h2>
          <p className="mt-1 whitespace-pre-wrap text-fg-muted">{data.coverNote}</p>
        </section>
      ) : null}

      <section
        aria-labelledby="postular-cv"
        data-testid="postular-cv"
        className="rounded-card border border-line p-3 text-sm"
      >
        <h2 id="postular-cv" className="font-semibold">
          Tu CV
        </h2>
        <p className="mt-1 text-fg-muted">
          Revisalo y descargalo desde la sección CV antes de postularte.
        </p>
        <Link
          href="/cv"
          className={`${buttonClasses({ size: "sm", variant: "secondary" })} mt-2 w-fit`}
        >
          Abrir mi CV
        </Link>
      </section>

      <section
        aria-labelledby="postular-checklist"
        data-testid="postular-checklist"
        className="rounded-card border border-line p-3 text-sm"
      >
        <h2 id="postular-checklist" className="font-semibold">
          Antes de postularte
        </h2>
        <ol className="mt-2 list-decimal pl-5 text-fg">
          {checklist.map((item) => (
            <li key={item.key} className="py-0.5">
              {item.text}
            </li>
          ))}
        </ol>
      </section>

      <div className="flex flex-col gap-1">
        {url ? (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="ir-al-aviso"
            className={`${buttonClasses({})} w-full sm:w-fit`}
          >
            Ir al aviso ↗<span className="sr-only"> (se abre en otra pestaña)</span>
          </a>
        ) : (
          <p data-testid="sin-enlace" className="text-sm text-fg-muted">
            Este aviso no tiene un enlace seguro (https) para abrir desde acá.
          </p>
        )}
      </div>
    </article>
  );
}
