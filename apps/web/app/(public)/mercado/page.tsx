import { SHOWCASE_TOP_MIN_JOBS, UNLISTED_ROLE_KEYS } from "@job-search-os/pipeline";
import type { Metadata } from "next";
import Link from "next/link";
import { careerLabel } from "@/lib/career-market";
import { getPoolShowcase } from "@/lib/showcase";
import { CareerChips } from "./career-chips";
import { PoolNumbers } from "./pool-numbers";

// ISR (ronda 63): la página se calcula una vez por hora, no por visita
export const revalidate = 3600;
export const metadata: Metadata = {
  title: "Mercado: qué piden las ofertas por carrera",
  description:
    "Qué skills, nivel de inglés y sueldos piden las ofertas públicas de cada carrera, y datos curiosos del pool.",
  alternates: { canonical: "/mercado" },
};

const NF = new Intl.NumberFormat("es-AR");
const DATE_FORMAT = new Intl.DateTimeFormat("es-AR", {
  dateStyle: "long",
  timeZone: "America/Argentina/Buenos_Aires",
});
const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);

export default async function MercadoPage() {
  const showcase = await getPoolShowcase();
  const ar = showcase?.argentina;
  const arTotal = ar ? ar.accepts + ar.excludes + ar.unknown : 0;
  const known = ar ? ar.accepts + ar.excludes : 0;
  // Igual que los chips y el sitemap: una carrera oculta no se nombra en «Datos curiosos» (ADR-022)
  const remoteByRole =
    showcase?.remoteByRole.filter((r) => !UNLISTED_ROLE_KEYS.includes(r.role)) ?? [];

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold text-fg">Mercado</h1>
        <p className="max-w-2xl text-base text-fg-muted">
          Lo que piden las ofertas públicas que leemos todos los días. Elegí una carrera para ver
          skills, inglés, seniority y sueldos.
        </p>
      </header>

      <section aria-labelledby="numeros" className="flex flex-col gap-3">
        <h2 id="numeros" className="text-xl font-semibold text-fg">
          El pool, hoy
        </h2>
        <PoolNumbers showcase={showcase} />
      </section>

      <section aria-labelledby="carreras" className="flex flex-col gap-3">
        <h2 id="carreras" className="text-xl font-semibold text-fg">
          Por carrera
        </h2>
        <CareerChips base="/mercado" label="Carreras" />
      </section>

      {showcase && showcase.active > 0 ? (
        <section aria-labelledby="curiosos" className="flex flex-col gap-4">
          <h2 id="curiosos" className="text-xl font-semibold text-fg">
            Datos curiosos
          </h2>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="flex min-w-0 flex-col gap-2 rounded-card border border-line bg-surface p-4">
              <h3 className="text-sm font-semibold text-fg">Carreras con más ofertas remotas</h3>
              {remoteByRole.length ? (
                <ol className="flex flex-col gap-1 text-sm text-fg">
                  {remoteByRole.map((r) => (
                    <li key={r.role} className="break-words">
                      {/* Sin prefetch, como los chips: es una lista de páginas ISR */}
                      <Link
                        href={`/mercado/${r.role}`}
                        prefetch={false}
                        className="text-fg-muted underline underline-offset-2 hover:text-fg"
                      >
                        {careerLabel(r.role)}
                      </Link>{" "}
                      · {NF.format(r.remote)} {r.remote === 1 ? "oferta" : "ofertas"}
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-sm text-fg-subtle">Todavía no hay ofertas remotas.</p>
              )}
            </div>

            <div className="flex min-w-0 flex-col gap-2 rounded-card border border-line bg-surface p-4">
              <h3 className="text-sm font-semibold text-fg">
                Ofertas que aceptan Argentina o LATAM
              </h3>
              {known > 0 ? (
                <p className="text-sm text-fg">
                  <span className="text-2xl font-semibold">{pct(ar!.accepts, known)} %</span> de las
                  que lo dicen ({NF.format(ar!.accepts)} de {NF.format(known)}).
                </p>
              ) : (
                <p className="text-sm text-fg-subtle">Todavía no hay datos suficientes.</p>
              )}
              <p className="text-xs text-fg-subtle">
                {NF.format(ar!.unknown)} de {NF.format(arTotal)} ofertas no lo dicen, y no las
                contamos ni a favor ni en contra.
              </p>
            </div>

            <div className="flex min-w-0 flex-col gap-2 rounded-card border border-line bg-surface p-4">
              <h3 className="text-sm font-semibold text-fg">
                Empresas con más avisos en la muestra
              </h3>
              {showcase.topCompanies.length ? (
                <ol className="flex flex-col gap-1 text-sm text-fg">
                  {showcase.topCompanies.map((c) => (
                    <li key={c.company} className="break-words">
                      {c.company} · {NF.format(c.jobs)} {c.jobs === 1 ? "aviso" : "avisos"}
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-sm text-fg-muted">
                  Ninguna empresa llega a {SHOWCASE_TOP_MIN_JOBS} avisos.
                </p>
              )}
              <p className="text-xs text-fg-muted">
                Calculado el {DATE_FORMAT.format(new Date(showcase.computedAt))} sobre{" "}
                {NF.format(showcase.active)} avisos, con el nombre tal como lo publica cada aviso.
                Solo entran empresas con {SHOWCASE_TOP_MIN_JOBS} avisos o más. La muestra son las
                fuentes que leemos, no todo el mercado.
              </p>
            </div>
          </div>
        </section>
      ) : null}

      <p className="flex flex-wrap items-center gap-x-2 text-sm text-fg-muted">
        <Link
          href="/acceso"
          className="inline-flex min-h-11 items-center underline underline-offset-2 hover:text-fg"
        >
          Pedir acceso
        </Link>
        <span>para ver qué tan bien te calza cada oferta.</span>
      </p>
    </div>
  );
}
