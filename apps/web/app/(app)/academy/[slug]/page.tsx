import Link from "next/link";
import { notFound } from "next/navigation";
import { cardClasses } from "@/components/ui";
import { fichaWordCount, loadApprovedFicha, loadApprovedFichas } from "@/lib/academy";
import {
  fichaRelacionadas,
  parseOrigen,
  readingMinutes,
  recomendadasPorOrigen,
} from "@/lib/academy-lectura";
import { renderLegalBlocks } from "@/lib/legal";

// Dentro de (app): el layout pide sesión, así que no se prerenderiza en el build
export const dynamic = "force-dynamic";

/** Una ficha aprobada. Una en borrador o que no existe da 404. Server Component. */
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ficha = loadApprovedFicha(slug);
  return { title: ficha ? ficha.titulo : "Academy" };
}

export default async function AcademyFichaPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ desde?: string | string[] }>;
}) {
  const { slug } = await params;
  const { desde } = await searchParams;
  const ficha = loadApprovedFicha(slug);
  if (!ficha) notFound();

  // Solo fichas aprobadas: ni «Te puede servir» ni las relacionadas muestran borradores
  const aprobadas = loadApprovedFichas();
  const titulos = new Map(aprobadas.map((f) => [f.slug, f.titulo]));
  const disponibles = [...titulos.keys()];
  const sugeridas = recomendadasPorOrigen(parseOrigen(desde), disponibles, slug);
  const relacionadas = fichaRelacionadas(slug, disponibles).filter((s) => !sugeridas.includes(s));
  const minutos = readingMinutes(fichaWordCount(ficha));

  return (
    <article className="mx-auto flex max-w-prose flex-col gap-1 break-words">
      <Link href="/academy" className="text-sm text-link underline underline-offset-2">
        ← Academy
      </Link>
      <h1 className="mt-2 text-title font-bold">{ficha.titulo}</h1>
      <p className="m-0 text-sm text-fg-muted" data-testid="academy-lectura">
        {minutos} min de lectura
      </p>
      {sugeridas.length > 0 ? (
        <aside
          aria-labelledby="academy-sugeridas"
          className={`${cardClasses()} mt-2`}
          data-testid="academy-te-puede-servir"
        >
          <h2 id="academy-sugeridas" className="m-0 text-base font-bold text-fg">
            Te puede servir
          </h2>
          <FichaLinks slugs={sugeridas} titulos={titulos} />
        </aside>
      ) : null}
      <div className="text-base">{renderLegalBlocks(ficha.blocks)}</div>
      {relacionadas.length > 0 ? (
        <nav
          aria-labelledby="academy-relacionadas"
          className="mt-4 flex flex-col gap-1 border-t border-border pt-3"
          data-testid="academy-relacionadas"
        >
          <h2 id="academy-relacionadas" className="m-0 text-base font-bold text-fg">
            Fichas relacionadas
          </h2>
          <FichaLinks slugs={relacionadas} titulos={titulos} />
        </nav>
      ) : null}
    </article>
  );
}

function FichaLinks({ slugs, titulos }: { slugs: string[]; titulos: Map<string, string> }) {
  return (
    <ul className="m-0 flex list-none flex-col gap-1 p-0">
      {slugs.map((s) => (
        <li key={s}>
          <Link
            href={`/academy/${s}`}
            className="inline-flex min-h-11 items-center text-link underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
          >
            {titulos.get(s) ?? s}
          </Link>
        </li>
      ))}
    </ul>
  );
}
