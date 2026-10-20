import { SHOWCASE_TOP_MIN_JOBS } from "@job-search-os/pipeline";
import Link from "next/link";
import { careerLabel } from "@/lib/career-market";
import { getPoolShowcase } from "@/lib/showcase";
import { CareerChips } from "./career-chips";
import { PoolNumbers } from "./pool-numbers";

// ISR (ronda 63): la página se calcula una vez por hora, no por visita
export const revalidate = 3600;
export const metadata = {
  title: "Mercado: qué piden las ofertas por carrera",
  description:
    "Qué skills, nivel de inglés y sueldos piden las ofertas públicas de cada carrera, y datos curiosos del pool.",
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

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold">Mercado</h1>
        <p className="max-w-2xl text-base text-zinc-700">
          Lo que piden las ofertas públicas que leemos todos los días. Elegí una carrera para ver
          skills, inglés, seniority y sueldos.
        </p>
      </header>

      <section aria-labelledby="numeros" className="flex flex-col gap-3">
        <h2 id="numeros" className="text-xl font-semibold">
          El pool, hoy
        </h2>
        <PoolNumbers showcase={showcase} />
      </section>

      <section aria-labelledby="carreras" className="flex flex-col gap-3">
        <h2 id="carreras" className="text-xl font-semibold">
          Por carrera
        </h2>
        <CareerChips base="/mercado" label="Carreras" />
      </section>

      {showcase && showcase.active > 0 ? (
        <section aria-labelledby="curiosos" className="flex flex-col gap-4">
          <h2 id="curiosos" className="text-xl font-semibold">
            Datos curiosos
          </h2>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="flex min-w-0 flex-col gap-2 rounded-md border border-zinc-200 bg-white p-4">
              <h3 className="text-sm font-semibold">Carreras con más ofertas remotas</h3>
              {showcase.remoteByRole.length ? (
                <ol className="flex flex-col gap-1 text-sm text-zinc-800">
                  {showcase.remoteByRole.map((r) => (
                    <li key={r.role} className="break-words">
                      <Link href={`/mercado/${r.role}`} className="underline">
                        {careerLabel(r.role)}
                      </Link>{" "}
                      · {NF.format(r.remote)} {r.remote === 1 ? "oferta" : "ofertas"}
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-sm text-zinc-600">Todavía no hay ofertas remotas.</p>
              )}
            </div>

            <div className="flex min-w-0 flex-col gap-2 rounded-md border border-zinc-200 bg-white p-4">
              <h3 className="text-sm font-semibold">Ofertas que aceptan Argentina o LATAM</h3>
              {known > 0 ? (
                <p className="text-sm text-zinc-800">
                  <span className="text-2xl font-semibold">{pct(ar!.accepts, known)} %</span> de las
                  que lo dicen ({NF.format(ar!.accepts)} de {NF.format(known)}).
                </p>
              ) : (
                <p className="text-sm text-zinc-600">Todavía no hay datos suficientes.</p>
              )}
              <p className="text-xs text-zinc-600">
                {NF.format(ar!.unknown)} de {NF.format(arTotal)} ofertas no lo dicen, y no las
                contamos ni a favor ni en contra.
              </p>
            </div>

            <div className="flex min-w-0 flex-col gap-2 rounded-md border border-zinc-200 bg-white p-4">
              <h3 className="text-sm font-semibold">Empresas con más avisos en la muestra</h3>
              {showcase.topCompanies.length ? (
                <ol className="flex flex-col gap-1 text-sm text-zinc-800">
                  {showcase.topCompanies.map((c) => (
                    <li key={c.company} className="break-words">
                      {c.company} · {NF.format(c.jobs)} {c.jobs === 1 ? "aviso" : "avisos"}
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-sm text-zinc-600">
                  Ninguna empresa llega a {SHOWCASE_TOP_MIN_JOBS} avisos.
                </p>
              )}
              <p className="text-xs text-zinc-600">
                Calculado el {DATE_FORMAT.format(new Date(showcase.computedAt))} sobre{" "}
                {NF.format(showcase.active)} avisos, con el nombre tal como lo publica cada aviso.
                Solo entran empresas con {SHOWCASE_TOP_MIN_JOBS} avisos o más. La muestra son las
                fuentes que leemos, no todo el mercado.
              </p>
            </div>
          </div>
        </section>
      ) : null}

      <p className="flex flex-wrap items-center gap-x-2 text-sm text-zinc-700">
        <Link href="/acceso" className="inline-flex min-h-11 items-center underline">
          Pedir acceso
        </Link>
        <span>para ver qué tan bien te calza cada oferta.</span>
      </p>
    </div>
  );
}
