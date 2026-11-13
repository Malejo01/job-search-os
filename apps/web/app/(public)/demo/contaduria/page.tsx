import { FALTA_KIND_LABEL } from "@job-search-os/pipeline";
import type { Metadata } from "next";
import { publicOpenGraph } from "@/lib/public-og";
import Link from "next/link";
import { FitPointsPanel } from "@/app/(app)/jobs/[id]/fit-points-panel";
import { Badge, buttonClasses, Icon, Seal } from "@/components/ui";
import { DEMO_OFFERS, DEMO_PENDING, DEMO_PERSON, type DemoOffer } from "@/lib/demo-contaduria";
import { ACTION_ADVICE, ACTION_LABELS } from "@/lib/labels";
import { DemoPaste } from "./demo-paste";

// Todo es fijo: la página se arma una vez en el build, sin base ni IA
export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Demo: así se ve para alguien de contaduría",
  description:
    "Un ejemplo con datos inventados: el perfil de una contadora, cuatro ofertas con su puntaje, lo que tiene a favor y lo que le falta, y cómo completar una oferta sin descripción.",
  alternates: { canonical: "/demo/contaduria" },
  openGraph: publicOpenGraph({ path: "/demo/contaduria" }),
};

const STEPS: Array<[string, string]> = [
  ["Abrí el aviso", "con el enlace de la oferta."],
  ["Copiá el texto", "completo del puesto: tareas, requisitos y beneficios."],
  ["Pegalo acá", "y guardá: la oferta pasa a la cola para evaluar."],
];

const SECTION = "flex flex-col gap-3";
const H2 = "font-display text-xl font-bold text-fg";

/**
 * Demo de una carrera no tech (C7-13): contaduría, con datos inventados y deterministas. Pensada para
 * el celular (grabar un video de 2 a 3 minutos el 11/11): primero quién es la persona, después
 * «Hoy» con sus mejores ofertas, el detalle con por qué sí y por qué no, y una oferta sin
 * descripción para mostrar cómo se completa. Nada se guarda.
 */
export default function DemoContaduriaPage() {
  const high = DEMO_OFFERS.filter((o) => o.score >= 7).length;
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8">
      <header className="flex flex-col gap-2 rounded-container bg-ink p-5 text-on-ink sm:p-8">
        <p className="text-xs font-bold tracking-wide text-on-ink-muted uppercase">
          Ejemplo con datos inventados
        </p>
        <h1 className="text-2xl leading-tight font-extrabold sm:text-3xl">
          Así se ve para alguien de contaduría
        </h1>
        <p className="text-sm text-on-ink-muted">
          {DEMO_PERSON.name} es una persona inventada. Las ofertas, las empresas y los puntajes
          también: los escribimos para mostrar cómo funciona. Con tu cuenta, son tus ofertas y tu
          perfil.
        </p>
      </header>

      <section aria-labelledby="demo-perfil" className={SECTION}>
        <h2 id="demo-perfil" className={H2}>
          El perfil de {DEMO_PERSON.name}
        </h2>
        <div className="flex flex-col gap-3 rounded-card bg-surface p-4">
          <p className="flex items-center gap-2 text-sm font-bold">
            <Icon name="perfil" size={20} className="text-brand-text" />
            {DEMO_PERSON.career}
          </p>
          <p className="text-sm text-fg-muted">{DEMO_PERSON.summary}</p>
          <ul aria-label="Lo que sabe" className="m-0 flex list-none flex-wrap gap-1.5 p-0">
            {DEMO_PERSON.skills.map((s) => (
              <li key={s}>
                <Badge shape="square">{s}</Badge>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section aria-labelledby="demo-hoy" className={SECTION}>
        <h2 id="demo-hoy" className={H2}>
          Hoy
        </h2>
        <p className="font-display text-2xl font-extrabold">Buen día, {DEMO_PERSON.name}.</p>
        <p className="text-[15px] text-fg-muted">
          Hay <span className="font-bold text-brand-text">{high} ofertas</span> con puntaje alto
          para mirar.
        </p>
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {DEMO_OFFERS.map((o) => (
            <li key={o.id} className="relative flex items-start gap-3 rounded-card bg-surface p-3">
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <a
                  href={`#${o.id}`}
                  className="truncate text-[15px] font-bold text-fg after:absolute after:inset-0 after:rounded-card focus-visible:outline-none focus-visible:after:outline focus-visible:after:outline-2 focus-visible:after:outline-focus"
                >
                  {o.title}
                </a>
                <span className="text-xs break-words text-fg-subtle">
                  {o.company} · {o.place}
                </span>
                <span className="line-clamp-2 text-xs text-fg-muted">{o.why}</span>
              </div>
              <Seal score={o.score} />
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="demo-detalle" className={SECTION}>
        <h2 id="demo-detalle" className={H2}>
          Por qué sí y por qué no
        </h2>
        {DEMO_OFFERS.map((o) => (
          <OfferDetail key={o.id} offer={o} />
        ))}
      </section>

      <section aria-labelledby="demo-sin-descripcion" className={SECTION}>
        <h2 id="demo-sin-descripcion" className={H2}>
          Una oferta sin descripción
        </h2>
        <div className="flex flex-col gap-3 rounded-card bg-surface p-4">
          <div>
            <p className="text-[15px] font-bold">{DEMO_PENDING.title}</p>
            <p className="text-xs text-fg-subtle">
              {DEMO_PENDING.company} · {DEMO_PENDING.place} · {DEMO_PENDING.date} ·{" "}
              {DEMO_PENDING.source}
            </p>
          </div>
          <p className="text-sm text-fg-muted">
            Llegó por email sin el texto del aviso. Con la descripción completa la evaluamos contra
            tu perfil.
          </p>
          <ol className="m-0 flex list-none flex-col gap-2 p-0 text-sm text-fg-muted">
            {STEPS.map(([strong, rest], i) => (
              <li key={strong} className="flex items-start gap-3">
                <span
                  aria-hidden="true"
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-pill bg-ink font-display text-sm font-extrabold text-on-ink"
                >
                  {i + 1}
                </span>
                <span className="pt-0.5">
                  <span className="font-bold text-fg">{strong}</span> {rest}
                </span>
              </li>
            ))}
          </ol>
          <DemoPaste />
        </div>
      </section>

      <section className="flex flex-col gap-3 rounded-container bg-ink p-5 text-on-ink">
        <p className="font-display text-xl font-extrabold">Vos decidís.</p>
        <p className="text-sm text-on-ink-muted">
          La postulación la hacés vos en el sitio del aviso: nunca postulamos por vos. El cupo de la
          beta es limitado.
        </p>
        <Link href="/acceso" className={buttonClasses({ className: "self-start" })}>
          Pedir acceso
        </Link>
      </section>
    </div>
  );
}

function OfferDetail({ offer }: { offer: DemoOffer }) {
  return (
    <article
      id={offer.id}
      aria-labelledby={`${offer.id}-titulo`}
      data-testid="demo-contaduria-oferta"
      className="flex scroll-mt-20 flex-col gap-3 rounded-card bg-surface p-4"
    >
      <div className="flex items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h3 id={`${offer.id}-titulo`} className="text-base font-bold">
            {offer.title}
          </h3>
          <p className="text-xs text-fg-subtle">
            {offer.company} · {offer.place} · {offer.date}
          </p>
          <div className="flex flex-wrap gap-1.5">
            <Badge shape="square" tone="info">
              {offer.source}
            </Badge>
            {offer.risks.map((r) => (
              <Badge key={r} shape="square" tone="warning">
                Riesgo: {r}
              </Badge>
            ))}
            <Badge shape="square">{ACTION_LABELS[offer.action]}</Badge>
          </div>
        </div>
        <Seal score={offer.score} size="detail" />
      </div>
      <FitPointsPanel points={offer.points} headingLevel={4} />
      <p className="text-sm font-semibold text-fg">
        {ACTION_ADVICE[offer.action]}
        {offer.points.falta.some((p) => p.kind === "frena")
          ? ` (${FALTA_KIND_LABEL.frena.toLowerCase()} algo que pide el aviso).`
          : "."}
      </p>
    </article>
  );
}
