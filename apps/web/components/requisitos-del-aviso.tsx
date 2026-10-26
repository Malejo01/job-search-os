import Link from "next/link";
import { SkillLevelButton } from "@/app/(app)/jobs/[id]/skill-level-modal";
import type { ChecklistItemView, ChecklistView } from "@/lib/job-detail";
import { CHECKLIST_PIDE_SOURCE, CHECKLIST_STATUS, CHECKLIST_TENES_SOURCE } from "@/lib/labels";

/**
 * «Requisitos del aviso» (ronda 104, diseño 98 §2 y §4). Server Component: sin estado ni cliente.
 * Muestra el checklist guardado en `decision.checklist`; el estado de cada ítem lo calculó el código
 * (nunca el modelo) y se comunica con ícono y texto, no solo con color. `compact` es la versión de la
 * demo pública: titular, primera mirada y lista corta, sin citas ni links a pantallas privadas.
 */
function StatusBadge({ status }: { status: ChecklistItemView["status"] }) {
  const st = CHECKLIST_STATUS[status];
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium ${st.classes}`}
    >
      <span aria-hidden="true">{st.icon}</span>
      {/* El rótulo en su propio nodo: un lector (o un test) lo encuentra sin el ícono pegado */}
      <span>{st.label}</span>
    </span>
  );
}

/** Ítems cuyo dato faltante se carga en «Tu perfil». El resto no tiene a dónde ir a completarlo. */
const PROFILE_CTA_IDS = new Set(["anos", "ingles", "jornada"]);

/**
 * Cómo cargar el dato que falta; null si no hay dónde cargarlo. Las skills no linkean (C-20): llevan
 * el slug para abrir el modal de nivel sin salir de la oferta. Años, inglés y jornada siguen
 * linkeando a «Tu perfil».
 */
export type MissingCta =
  { href: string; text: string } | { slug: string; name: string; text: string };

export function missingCta(item: ChecklistItemView): MissingCta | null {
  if (item.id.startsWith("skill:")) {
    // El nombre sale de «Menciona {nombre}» (lo arma buildChecklist)
    const name = item.pide.replace(/^Menciona\s+/i, "");
    return { slug: item.id.slice("skill:".length), name, text: `Cargar mi nivel de ${name}` };
  }
  if (PROFILE_CTA_IDS.has(item.id)) {
    return { href: "/settings/perfil", text: `Completá este dato en Tu perfil: ${item.pide}` };
  }
  return null;
}

/** Datos para abrir el modal de nivel; sin ellos (otras pantallas) la skill linkea a Ajustes. */
type SkillModalData = { jobId: string; skillInfo: Record<string, { description: string | null }> };

function Item({
  item,
  compact,
  modal,
}: {
  item: ChecklistItemView;
  compact: boolean;
  modal?: SkillModalData;
}) {
  const cta = item.status === "no_se_sabe" && !compact ? missingCta(item) : null;
  return (
    <li className="flex min-w-0 flex-col gap-0.5 border-t border-zinc-200 py-2 first:border-t-0">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <StatusBadge status={item.status} />
        <span className="min-w-0 break-words font-medium">{item.pide}</span>
        {item.nivel === "deseable" ? (
          <span className="text-xs text-zinc-600">(deseable)</span>
        ) : null}
        {item.bloquea ? <span className="text-xs font-medium text-red-900">(frena)</span> : null}
      </p>
      <p className="break-words text-xs text-zinc-600">
        Lo que pide ({CHECKLIST_PIDE_SOURCE[item.fuente.pide]})
        {!compact && item.evidencia ? <span className="italic"> · «{item.evidencia}»</span> : null}
      </p>
      <p className="break-words text-xs text-zinc-600">
        {item.tenes !== null && item.fuente.tenes
          ? `Tenés (${CHECKLIST_TENES_SOURCE[item.fuente.tenes]}): ${item.tenes}`
          : "Tenés: no lo sabemos"}
      </p>
      {item.nota ? (
        <p data-testid="requisito-nota" className="break-words text-xs text-zinc-600">
          {item.nota}
        </p>
      ) : null}
      {cta && "slug" in cta && modal ? (
        <div className="pt-1">
          <SkillLevelButton
            slug={cta.slug}
            name={cta.name}
            description={modal.skillInfo[cta.slug]?.description ?? null}
            jobId={modal.jobId}
          />
        </div>
      ) : cta ? (
        <p className="text-xs">
          <Link
            href={"href" in cta ? cta.href : "/settings/skills"}
            className="inline-flex min-h-8 items-center text-sky-800 underline"
          >
            {"href" in cta ? cta.text : `Cargá tu nivel de ${cta.name}`}
          </Link>
        </p>
      ) : null}
    </li>
  );
}

export function RequisitosDelAviso({
  checklist,
  compact = false,
  modal,
}: {
  checklist: ChecklistView;
  compact?: boolean;
  /** Con esto, cada skill sin nivel abre el modal «Cargar mi nivel de X» (detalle de la oferta). */
  modal?: SkillModalData;
}) {
  const { must, deseable, items, parcial, descarte_rapido: descarte } = checklist;
  const total = must.cumple + must.no_cumple;
  const deseableTotal = deseable.cumple + deseable.no_cumple;
  // Las skills que el aviso solo nombra (fase A) no entran al titular: van en una lista aparte
  const named = items.filter((i) => i.kind === "skill" && i.fuente.pide === "fuente");
  const main = items.filter((i) => !named.includes(i));
  const Heading = compact ? "h4" : "h2";
  return (
    <section
      aria-label="Requisitos del aviso"
      className="flex min-w-0 flex-col gap-2 rounded-md border border-zinc-200 p-3 text-sm"
    >
      <Heading className="font-semibold">Requisitos del aviso</Heading>
      <p data-testid="requisitos-titular">
        {total === 0 ? (
          "No hay requisitos verificables; mirá la lista"
        ) : (
          <>
            Cumplís{" "}
            <strong>
              {must.cumple} de {total}
            </strong>{" "}
            requisitos excluyentes
            {must.no_se_sabe > 0
              ? ` y ${must.no_se_sabe} que no podemos verificar con tu perfil`
              : ""}
          </>
        )}
      </p>
      {!compact && (deseableTotal > 0 || deseable.no_se_sabe > 0) ? (
        <p className="text-xs text-zinc-700">
          Deseables: cumplís {deseable.cumple} de {deseableTotal}
          {deseable.no_se_sabe > 0 ? ` y ${deseable.no_se_sabe} sin verificar` : ""}
        </p>
      ) : null}
      {parcial ? (
        <p className="text-xs text-amber-900">
          Sin la descripción completa: esta lista sale del resumen del aviso y puede estar
          incompleta.
        </p>
      ) : null}

      <div className="rounded-md bg-zinc-50 p-2" data-testid="requisitos-descarte">
        <p className="text-xs font-semibold">Lo primero que mira un reclutador</p>
        <p className="break-words">
          {descarte
            ? `Lo primero por lo que te descartarían: ${descarte.pide}${
                descarte.tenes ? ` (tenés ${descarte.tenes})` : ""
              }`
            : "Nada evidente: tu perfil pasa la primera mirada"}
        </p>
      </div>

      {main.length ? (
        <ul className="flex flex-col">
          {(compact ? main.filter((i) => i.nivel === "must") : main).map((item) => (
            <Item key={item.id} item={item} compact={compact} modal={modal} />
          ))}
        </ul>
      ) : null}

      {!compact && named.length ? (
        <div>
          <h3 className="text-xs font-semibold">Skills que nombra el aviso</h3>
          <p className="text-xs text-zinc-600">
            El aviso las menciona, pero no sabemos si las exige: no cuentan en el titular.
          </p>
          <ul className="flex flex-col">
            {named.map((item) => (
              <Item key={item.id} item={item} compact={compact} modal={modal} />
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
