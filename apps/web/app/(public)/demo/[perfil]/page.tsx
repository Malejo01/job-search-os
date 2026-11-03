import { getDemoProfile } from "@job-search-os/pipeline";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDemoEvaluations } from "@/lib/demo";
import { parseChecklist } from "@/lib/job-detail";
import { EvaluationCard } from "./evaluation-card";
import { Tour } from "./tour";

// ISR (ronda 74): sin rutas prerenderizadas (el build no necesita base); cada perfil se genera en la
// primera visita y queda cacheado una hora.
export const revalidate = 3600;
export const dynamicParams = true;
export function generateStaticParams() {
  return [];
}

const ENGLISH_BY_CEFR: Record<string, string> = {
  A2: "básico",
  B1: "intermedio",
  B2: "intermedio alto",
  C1: "avanzado",
  C2: "nativo/bilingüe",
};

type Props = { params: Promise<{ perfil: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const profile = getDemoProfile((await params).perfil);
  if (!profile) return {};
  return {
    title: `Demo: ofertas evaluadas para un perfil de ${profile.label}`,
    description: `${profile.tagline} Perfil inventado, ofertas reales.`,
  };
}

export default async function DemoProfilePage({ params }: Props) {
  const profile = getDemoProfile((await params).perfil);
  if (!profile) notFound();
  const rows = await getDemoEvaluations(profile.key);
  const hasRows = Boolean(rows?.length);
  const cefr = profile.profile.englishCefr;
  const english = cefr ? `${ENGLISH_BY_CEFR[cefr] ?? "sin dato"} (${cefr})` : "sin dato";
  const years = profile.profile.yearsTotal;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <p className="text-sm">
          <Link
            href="/demo"
            className="inline-flex min-h-11 items-center text-fg-muted underline underline-offset-2 hover:text-fg"
          >
            Todos los perfiles
          </Link>
        </p>
        <h1 className="text-3xl font-semibold">{profile.label}</h1>
        <div
          data-tour="demo:perfil"
          data-testid="demo-profile"
          className="flex flex-col gap-1 rounded-card border border-line bg-surface p-4"
        >
          <p className="text-xs font-semibold uppercase text-fg-subtle">Perfil inventado</p>
          <p className="text-sm text-fg">{profile.tagline}</p>
          <p className="text-sm text-fg-muted">
            {`Inglés ${english} · ${years} ${years === 1 ? "año" : "años"} de experiencia · busca trabajo remoto`}
          </p>
        </div>
        {hasRows ? (
          <div>
            <Tour />
          </div>
        ) : null}
      </header>

      <section aria-labelledby="evaluaciones" className="flex flex-col gap-3">
        <h2 id="evaluaciones" className="text-xl font-semibold">
          Ofertas evaluadas
        </h2>
        {hasRows ? (
          <p className="text-sm text-fg-muted">
            Puntaje de 0 a 10: qué tan bien calza cada oferta con este perfil.
          </p>
        ) : null}
        {hasRows && rows ? (
          <ul className="flex flex-col gap-3">
            {rows.map((row, i) => (
              <EvaluationCard
                key={row.publicJobId}
                row={row}
                tour={i === 0}
                checklist={parseChecklist({ checklist: row.checklist })}
              />
            ))}
          </ul>
        ) : (
          <div
            data-testid="demo-preparando"
            className="rounded-card border border-line bg-surface p-4 text-sm text-fg"
          >
            <p>Estamos preparando la demo. Volvé en un rato.</p>
            <Link
              href="/ofertas"
              className="inline-flex min-h-11 items-center underline underline-offset-2 hover:text-fg"
            >
              Mientras tanto, mirá las ofertas de muestra
            </Link>
          </div>
        )}
      </section>

      <p className="text-sm text-fg-muted">
        <Link
          href="/acceso"
          data-tour="demo:acceso"
          className="inline-flex min-h-11 items-center underline underline-offset-2 hover:text-fg"
        >
          ¿Querés verlo con tu perfil? Pedí acceso (el cupo de la beta es limitado)
        </Link>
      </p>
    </div>
  );
}
