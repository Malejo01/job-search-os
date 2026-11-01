import { DEMO_PROFILES } from "@job-search-os/pipeline";
import type { Metadata } from "next";
import Link from "next/link";
import { getDemoCounts } from "@/lib/demo";

// ISR (ronda 74): las evaluaciones se calculan una vez por semana; la página se arma una vez por hora.
export const revalidate = 3600;
export const metadata: Metadata = {
  title: "Demo: así evalúa ofertas reales",
  description:
    "Mirá cómo evalúa ofertas reales para tres perfiles inventados: puntaje, por qué sí, por qué no y acción sugerida.",
  alternates: { canonical: "/demo" },
};

export default async function DemoPage() {
  const counts = await getDemoCounts();
  const empty = !counts || DEMO_PROFILES.every((p) => (counts[p.key] ?? 0) === 0);
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold">Demo: así evalúa ofertas reales</h1>
        <p className="max-w-2xl text-base text-fg-muted">
          Así evalúa ofertas reales para tres perfiles inventados. Elegí uno y mirá el puntaje, por
          qué sí, por qué no y qué haríamos.
        </p>
      </header>
      {empty ? (
        <p
          role="status"
          data-testid="demo-preparando"
          className="rounded-card border border-line bg-surface p-4 text-sm text-fg"
        >
          Estamos preparando la demo. Volvé en un rato.
        </p>
      ) : null}
      <section aria-labelledby="perfiles" className="flex flex-col gap-3">
        <h2 id="perfiles" className="text-xl font-semibold">
          Elegí un perfil
        </h2>
        <ul className="grid gap-3 sm:grid-cols-3">
          {DEMO_PROFILES.map((p) => {
            const count = counts?.[p.key] ?? 0;
            return (
              <li
                key={p.key}
                data-testid="demo-profile-card"
                className="flex min-w-0 flex-col gap-2 rounded-card border border-line bg-surface p-4"
              >
                <h3 className="text-base font-semibold">{p.label}</h3>
                <p className="text-sm text-fg-muted">{p.tagline}</p>
                {count > 0 ? (
                  <p className="text-xs text-fg-muted">
                    {`${count} ${count === 1 ? "oferta evaluada" : "ofertas evaluadas"}`}
                  </p>
                ) : null}
                {empty ? (
                  <p className="inline-flex min-h-11 items-center text-sm text-fg-muted">Pronto</p>
                ) : (
                  <Link
                    href={`/demo/${p.key}`}
                    // Sin prefetch (ronda 85): cada perfil es una página ISR que lee la base
                    prefetch={false}
                    aria-label={`Ver la demo de ${p.label}`}
                    className="inline-flex min-h-11 items-center text-sm font-medium text-fg-muted underline underline-offset-2 hover:text-fg"
                  >
                    Ver la demo
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      </section>
      <p className="text-sm text-fg-muted">
        <Link
          href="/acceso"
          className="inline-flex min-h-11 items-center underline underline-offset-2 hover:text-fg"
        >
          ¿Querés verlo con tu perfil? Pedí acceso (el cupo de la beta es limitado)
        </Link>
      </p>
    </div>
  );
}
