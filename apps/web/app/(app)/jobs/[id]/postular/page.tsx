import Link from "next/link";
import { notFound } from "next/navigation";
import { EstadoMarca } from "@/components/estado-marca";
import { buttonClasses } from "@/components/ui";
import { ESTADOS_TEXTOS } from "@/lib/textos-rediseno";
import { isUuid } from "@/lib/ids";
import { requireUserId } from "@/lib/session";
import { cvForOffer } from "@job-search-os/pipeline";
import { cvCoachAllowedFor } from "@/lib/cv-coach/access";
import { cvTailorAllowedFor } from "@/lib/cv-tailor/server";
import { PostularTailor } from "./postular-tailor";
import { loadCvSource } from "@/lib/cv-source";
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
  const [data, cvSource] = await Promise.all([
    getPostularData(userId, id),
    loadCvSource(userId, { lang: "es", includeEmail: false, includeBasics: true }),
  ]);
  if (!data) notFound();
  const forOffer = cvSource
    ? cvForOffer({
        offerSkills: data.offerSkills,
        cvSkills: cvSource.skills.map((k) => k.name),
        history: cvSource.history,
      })
    : null;
  const [coachOn, tailorOn] = await Promise.all([
    cvCoachAllowedFor(userId),
    cvTailorAllowedFor(userId),
  ]);

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
        aria-labelledby="postular-cv-oferta"
        data-testid="postular-cv-oferta"
        className="rounded-card border border-line p-3 text-sm"
      >
        <h2 id="postular-cv-oferta" className="font-semibold">
          Tu CV frente a esta oferta
        </h2>
        {forOffer === null || !forOffer.ok ? (
          <EstadoMarca
            tipo="sin-datos"
            variant="inline"
            data-testid="cv-oferta-vacio"
            className="mt-2"
            action={
              forOffer && forOffer.error === "sin_requisitos" ? null : (
                <Link
                  href="/cv"
                  className={`${buttonClasses({ size: "sm", variant: "secondary" })} mt-1 w-fit`}
                >
                  {ESTADOS_TEXTOS.postularSinCv.action}
                </Link>
              )
            }
          >
            {forOffer && forOffer.error === "sin_requisitos"
              ? "No pudimos leer qué skills pide este aviso, así que no hay nada para cruzar con tu CV."
              : "Todavía no tenés un CV confirmado para cruzar con esta oferta. Armalo en la sección CV y volvé."}
          </EstadoMarca>
        ) : (
          <div className="mt-2 flex flex-col gap-3">
            <div>
              <h3 className="font-medium text-fg">Lo que pide el aviso</h3>
              <ul className="mt-1 flex flex-wrap gap-1.5" data-testid="cv-oferta-pedidas">
                {forOffer.value.asked.map((k) => (
                  <li key={k.name} className="rounded-card border border-line px-2 py-0.5 text-fg">
                    {k.name}
                    {k.isMust ? "" : " (deseable)"} ·{" "}
                    <span className="text-fg-muted">
                      {k.inCv ? "ya está en tu CV" : "no figura"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            {forOffer.value.missing.length ? (
              <p data-testid="cv-oferta-faltan" className="text-fg-muted">
                No figuran en tu CV: {forOffer.value.missing.map((m) => m.name).join(", ")}. Sumalas
                solo si de verdad las usaste.
              </p>
            ) : null}
            {forOffer.value.bullets.some((b) => b.matched.length > 0) ? (
              <div>
                <h3 className="font-medium text-fg">Viñetas para poner primero</h3>
                <ol
                  className="mt-1 list-decimal pl-5 text-fg-muted"
                  data-testid="cv-oferta-vinietas"
                >
                  {forOffer.value.bullets
                    .filter((b) => b.matched.length > 0)
                    .slice(0, 8)
                    .map((b, i) => (
                      <li key={i} className="py-0.5">
                        {b.text}{" "}
                        <span className="text-xs text-fg-subtle">
                          ({b.title || b.organization} · menciona {b.matched.join(", ")})
                        </span>
                      </li>
                    ))}
                </ol>
              </div>
            ) : (
              <p className="text-fg-muted">
                Ninguna viñeta de tu CV menciona las skills de este aviso.
              </p>
            )}
          </div>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          {cvSource ? (
            <a
              href={`/jobs/${data.id}/postular/descargar`}
              data-testid="descargar-cv-oferta"
              className={`${buttonClasses({ size: "sm" })} w-fit`}
            >
              Descargar mi CV para esta oferta (.docx)
            </a>
          ) : null}
          {coachOn ? (
            <Link
              href={`/cv/coach?oferta=${data.id}`}
              data-testid="afinar-cv"
              className={`${buttonClasses({ size: "sm", variant: "secondary" })} w-fit`}
            >
              Afinar mi CV para esta oferta
            </Link>
          ) : null}
        </div>
        {cvSource ? (
          <p className="mt-1 text-xs text-fg-subtle">
            Es tu CV confirmado con las viñetas reordenadas según la oferta. No reescribimos nada.
          </p>
        ) : null}
      </section>

      {tailorOn ? <PostularTailor jobId={data.id} /> : null}

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
