import Link from "next/link";
import { notFound } from "next/navigation";
import { AfiDice } from "@/components/afi-dice";
import { EstadoMarca } from "@/components/estado-marca";
import { buttonClasses } from "@/components/ui";
import { AFI_DICE, ESTADOS_TEXTOS, POSTULACION_TEXTOS as T } from "@/lib/textos-rediseno";
import { isUuid } from "@/lib/ids";
import { requireUserId } from "@/lib/session";
import { reviewCvForOffer } from "@job-search-os/pipeline";
import { cvCoachAllowedFor } from "@/lib/cv-coach/access";
import { cvTailorAllowedFor } from "@/lib/cv-tailor/server";
import { hasOfferVersion } from "@/lib/cv-tailor/versions";
import { DescargasVersion } from "./descargas-version";
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
    ? reviewCvForOffer({
        offerSkills: data.offerSkills,
        cvSkills: cvSource.skills.map((k) => k.name),
        history: cvSource.history,
        requirements: data.requirements,
      })
    : null;
  const [coachOn, tailorOn] = await Promise.all([
    cvCoachAllowedFor(userId),
    cvTailorAllowedFor(userId),
  ]);
  // Solo si la adaptación está disponible puede haber una versión guardada que ofrecer
  const hasAdapted = tailorOn ? await hasOfferVersion(userId, id) : null;

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
      {/* R28-15: Afi habla acá; si el CV no se puede cruzar, el estado vacío de abajo ya trae a Afi (un solo Afi) */}
      {forOffer !== null && forOffer.ok ? (
        <AfiDice pose="analizando" priority texto={AFI_DICE.preparar} testId="afi-dice-preparar" />
      ) : null}

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
          {T.revisar.titulo}
        </h2>
        <p className="mt-1 text-fg-muted">{T.revisar.intro}</p>
        {forOffer === null || !forOffer.ok ? (
          <EstadoMarca
            tipo="sin-datos"
            pose="analizando"
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
            {forOffer && forOffer.error === "sin_requisitos" ? T.revisar.sinDatos : T.revisar.sinCv}
          </EstadoMarca>
        ) : (
          <div className="mt-2 flex flex-col gap-3">
            <div>
              <h3 className="font-medium text-fg">Lo que pide el aviso</h3>
              <ul className="mt-1 flex flex-wrap gap-1.5" data-testid="cv-oferta-pedidas">
                {forOffer.value.covered.map((k) => (
                  <li key={k.name} className="rounded-card border border-line px-2 py-0.5 text-fg">
                    {k.name}
                    {k.isMust ? "" : ` (${T.revisar.deseable})`} ·{" "}
                    <span className="text-fg-muted">
                      ya está en tu CV:{" "}
                      {k.evidence
                        ? T.revisar.cubiertoEn.replace(
                            "{donde}",
                            k.evidence.organization || k.evidence.title,
                          )
                        : T.revisar.cubiertoSoloLista}
                    </span>
                  </li>
                ))}
                {forOffer.value.unbacked.map((k) => (
                  <li key={k.name} className="rounded-card border border-line px-2 py-0.5 text-fg">
                    {k.name}
                    {k.isMust ? "" : ` (${T.revisar.deseable})`} ·{" "}
                    <span className="text-fg-muted">no figura</span>
                  </li>
                ))}
              </ul>
            </div>
            {forOffer.value.unbacked.length ? (
              <div data-testid="cv-oferta-faltan" className="text-fg-muted">
                <h3 className="font-medium text-fg">{T.revisar.sinRespaldoTitulo}</h3>
                <p className="mt-1">
                  {forOffer.value.unbacked.map((m) => m.name).join(", ")}.{" "}
                  {T.revisar.sinRespaldoAyuda}
                </p>
              </div>
            ) : null}
            <div data-testid="cv-oferta-aclarar">
              <h3 className="font-medium text-fg">{T.revisar.aclararTitulo}</h3>
              {forOffer.value.toClarify.length ? (
                <ul className="mt-1 list-disc pl-5 text-fg-muted">
                  {forOffer.value.toClarify.map((c, i) => (
                    <li key={i} className="py-0.5">
                      {c.kind === "skill_sin_experiencia"
                        ? T.revisar.aclararSkill.replace("{nombre}", c.name)
                        : c.code === "ingles"
                          ? T.revisar.aclararIngles.replace("{pide}", c.pide)
                          : T.revisar.aclararOtro.replace("{pide}", c.pide)}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-fg-muted">{T.revisar.aclararVacio}</p>
              )}
              {forOffer.value.toClarify.some(
                (c) => c.kind === "requisito" && c.code === "ingles",
              ) ? (
                <Link
                  href="/settings/perfil"
                  className={`${buttonClasses({ size: "sm", variant: "secondary" })} mt-2 w-fit`}
                >
                  {T.revisar.abrirPerfil}
                </Link>
              ) : null}
            </div>
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
        <p className="mt-2 text-xs text-fg-subtle">{T.revisar.nota}</p>
      </section>

      {tailorOn ? <PostularTailor jobId={data.id} /> : null}

      {cvSource ? (
        <section
          aria-labelledby="postular-descargar"
          data-testid="postular-descargar"
          className="rounded-card border border-line p-3 text-sm"
        >
          <h2 id="postular-descargar" className="font-semibold">
            {T.descargar.titulo}
          </h2>
          <DescargasVersion jobId={data.id} hasAdapted={hasAdapted} />
        </section>
      ) : null}

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
