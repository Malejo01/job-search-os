import Link from "next/link";
import { notFound } from "next/navigation";
import { loadApprovedFicha } from "@/lib/academy";
import { renderLegalBlocks } from "@/lib/legal";

// Dentro de (app): el layout pide sesión, así que no se prerenderiza en el build
export const dynamic = "force-dynamic";

/** Una ficha aprobada. Una en borrador o que no existe da 404. Server Component. */
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ficha = loadApprovedFicha(slug);
  return { title: ficha ? ficha.titulo : "Academy" };
}

export default async function AcademyFichaPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ficha = loadApprovedFicha(slug);
  if (!ficha) notFound();
  return (
    <article className="mx-auto flex max-w-prose flex-col gap-1 break-words">
      <Link href="/academy" className="text-sm text-link underline underline-offset-2">
        ← Academy
      </Link>
      <h1 className="mt-2 text-title font-bold">{ficha.titulo}</h1>
      <div className="text-base">{renderLegalBlocks(ficha.blocks)}</div>
    </article>
  );
}
