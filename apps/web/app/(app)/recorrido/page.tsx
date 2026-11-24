import { notFound } from "next/navigation";
import { canViewRecorrido } from "@/lib/recorrido-access";
import { loadRecorridoTargets } from "@/lib/recorrido-targets";
import { RECORRIDO_SCREENS, resolveOpen } from "@/lib/recorrido";
import { requireUserId } from "@/lib/session";
import { RECORRIDO_TEXTOS as T } from "@/lib/textos-recorrido";
import { RecorridoList, type RecorridoItem } from "./recorrido-list";

export const metadata = { title: T.title, robots: { index: false } };
export const dynamic = "force-dynamic";

/**
 * Recorrido para revisar (R26-03): la lista de pantallas que miran Ani, Julieta y los testers. Solo admins y
 * testers (`canViewRecorrido`, comprobado en el servidor antes de leer nada); el resto recibe el 404. «Abrir»
 * lleva a la pantalla real con los datos de quien revisa: la primera oferta y la primera simulación se
 * resuelven acá, con su sesión (RLS), y al cliente solo llegan los links. Server Component; el progreso y
 * «Comentar esta pantalla» viven en `RecorridoList`.
 */
export default async function RecorridoPage() {
  const userId = await requireUserId();
  if (!(await canViewRecorrido(userId))) notFound();
  const targets = await loadRecorridoTargets(userId);

  const items: RecorridoItem[] = RECORRIDO_SCREENS.map((screen) => {
    const { href, resolved } = resolveOpen(screen, targets);
    return {
      ...screen,
      href,
      // Si falta algo para abrirla, se explica cómo llegar; las demás aclaraciones se muestran siempre
      showHowTo: !resolved || screen.open.kind === "route" || screen.open.kind === "primer-uso",
    };
  });

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <div className="flex flex-col gap-2">
        <h1 className="text-title font-bold">{T.title}</h1>
        <p className="text-fg-muted">{T.intro}</p>
      </div>
      <RecorridoList userId={userId} items={items} />
    </div>
  );
}
