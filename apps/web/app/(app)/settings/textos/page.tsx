import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { TextosAprobacionPanel } from "@/components/textos-aprobacion-panel";
import { canReviewAcademy } from "@/lib/academy-access";
import { requireUserId } from "@/lib/session";
import { textosRediseno } from "@/lib/textos-aprobacion";
import { TEXTOS_APROBACION } from "@/lib/textos-revision";
import { textReviewLatest } from "@/lib/textos-revisiones";
import { reviewTextoAction } from "./actions";

export const metadata: Metadata = { title: "Revisar textos", robots: { index: false } };
export const dynamic = "force-dynamic";

/**
 * Los textos del rediseño para quien los revisa (R26-02): admins y testers, con 404 para el resto (comprobado en el
 * servidor antes de leer nada). Cada texto se aprueba o se propone otro; una propuesta no cambia la app. Es la misma
 * lista que ve quien administra en `/admin/textos`.
 */
export default async function TextosRevisionPage() {
  const userId = await requireUserId();
  if (!(await canReviewAcademy(userId))) notFound();
  const textos = textosRediseno();
  // Si la lectura falla (cuenta sin el rol en la base, o migración sin aplicar), se ven los textos sin botones
  const latest = await textReviewLatest(userId).catch(() => null);
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <h1 className="text-title font-bold">{TEXTOS_APROBACION.titulo}</h1>
      <p className="text-fg-muted">{TEXTOS_APROBACION.introTester}</p>
      <Link
        href="/settings/academy"
        className="inline-flex min-h-11 items-center self-start text-link underline underline-offset-2"
      >
        Revisar Academy
      </Link>
      <TextosAprobacionPanel textos={textos} latest={latest} action={reviewTextoAction} />
    </div>
  );
}
