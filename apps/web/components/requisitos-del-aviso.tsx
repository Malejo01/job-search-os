import Link from "next/link";
import { Icon, type IconName } from "@/components/ui";
import type { ChecklistItemView, ChecklistView } from "@/lib/job-detail";
import { CHECKLIST_PIDE_SOURCE, CHECKLIST_STATUS, CHECKLIST_TENES_SOURCE } from "@/lib/labels";
import dynamic from "next/dynamic";

// R-1: el modal de nivel se baja solo cuando hay una skill para cargar (en /jobs, con el panel abierto)
const SkillLevelButton = dynamic(() =>
  import("./skill-level-modal").then((mod) => mod.SkillLevelButton),
);

/**
 * «Requisitos del aviso» (ronda 104, diseño 98 §2 y §4; checklist para mejorar D3 en C9-9). Server
 * Component: sin estado ni cliente. Muestra el checklist guardado en `decision.checklist` (o el que
 * se armó al leer, C9-6); el estado de cada ítem lo calculó el código (nunca el modelo) y acá solo
 * cambia cómo se ve: cada requisito con su check, su cruz o su signo de pregunta, con ícono y texto,
 * y lo que falta con un paso concreto. «Cómo aprenderlo» no se muestra: el plan de estudios todavía
 * no existe. `compact` es la versión de la demo pública: titular, primera mirada y lista corta, sin
 * citas ni links a pantallas privadas.
 */
const STATUS_ICON: Record<ChecklistItemView["status"], { icon: IconName; box: string }> = {
  cumple: { icon: "check", box: "bg-success-muted text-success" },
  no_cumple: { icon: "cruz", box: "bg-warning-muted text-warning" },
  no_se_sabe: { icon: "pregunta", box: "bg-surface-muted text-fg-muted" },
};

function StatusMark({ status }: { status: ChecklistItemView["status"] }) {
  const mark = STATUS_ICON[status];
  return (
    <span
      aria-hidden="true"
      className={`flex size-7 shrink-0 items-center justify-center rounded-pill ${mark.box}`}
    >
      <Icon name={mark.icon} size={16} />
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

/**
 * Lo que falta, dicho como un paso (C9-9, decisión 14 regla 2): no «te falta Tango», sino «sumá
 * Tango y esta oferta te queda más cerca». Solo para lo que no cumple; null si no hay un paso.
 */
export function missingStep(item: ChecklistItemView): string | null {
  if (item.status !== "no_cumple") return null;
  if (item.id.startsWith("skill:")) {
    const name = item.pide.replace(/^Menciona\s+/i, "");
    return `Sumá ${name} y esta oferta te queda mucho más cerca. Si ya la manejás, cargá tu nivel o sumala a tu CV.`;
  }
  if (PROFILE_CTA_IDS.has(item.id)) {
    return "Si ya lo tenés y no está en tu perfil, completalo: puede cambiar este resultado.";
  }
  return null;
}

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
  const cta = item.status !== "cumple" && !compact ? missingCta(item) : null;
  const step = compact ? null : missingStep(item);
  return (
    <li className="flex min-w-0 gap-3 border-t border-line py-3 first:border-t-0">
      <StatusMark status={item.status} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {/* El rótulo en su propio nodo: un lector (o un test) lo encuentra sin el ícono pegado */}
        <span className="text-xs font-bold text-fg-muted">
          {CHECKLIST_STATUS[item.status].label}
        </span>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="min-w-0 font-bold break-words">{item.pide}</span>
          {item.nivel === "deseable" ? (
            <span className="text-xs text-fg-subtle">(deseable)</span>
          ) : null}
          {item.bloquea ? <span className="text-xs font-bold text-danger">(frena)</span> : null}
        </p>
        {step ? <p className="text-sm break-words text-fg">{step}</p> : null}
        <p className="break-words text-xs text-fg-subtle">
          Lo que pide ({CHECKLIST_PIDE_SOURCE[item.fuente.pide]})
          {!compact && item.evidencia ? (
            <span className="italic"> · «{item.evidencia}»</span>
          ) : null}
        </p>
        <p className="break-words text-xs text-fg-subtle">
          {item.tenes !== null && item.fuente.tenes
            ? `Tenés (${CHECKLIST_TENES_SOURCE[item.fuente.tenes]}): ${item.tenes}`
            : "Tenés: no lo sabemos"}
        </p>
        {item.nota ? (
          <p data-testid="requisito-nota" className="break-words text-xs text-fg-subtle">
            {item.nota}
          </p>
        ) : null}
        {/* El botón solo si el slug está en la taxonomía (`skillInfo`); si no, el link de siempre */}
        {cta && "slug" in cta && modal && modal.skillInfo[cta.slug] ? (
          <div className="pt-1">
            <SkillLevelButton
              slug={cta.slug}
              name={cta.name}
              description={modal.skillInfo[cta.slug]?.description ?? null}
              jobId={modal.jobId}
            />
          </div>
        ) : cta ? (
          <p className="text-sm">
            <Link
              href={"href" in cta ? cta.href : "/settings/skills"}
              className="inline-flex min-h-11 items-center font-semibold text-link underline underline-offset-2"
            >
              {"href" in cta ? cta.text : `Cargá tu nivel de ${cta.name}`}
            </Link>
          </p>
        ) : null}
      </div>
    </li>
  );
}

export function RequisitosDelAviso({
  checklist,
  compact = false,
  modal,
  rebuilt = false,
}: {
  checklist: ChecklistView;
  compact?: boolean;
  /** Se armó al leer (C9-6) porque la evaluación es de antes de esta lista. */
  rebuilt?: boolean;
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
      className="flex min-w-0 flex-col gap-3 rounded-card bg-surface p-4 text-sm sm:p-5"
    >
      <Heading className="font-display text-heading font-bold">Requisitos del aviso</Heading>
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
        <p className="text-xs text-fg-muted">
          Deseables: cumplís {deseable.cumple} de {deseableTotal}
          {deseable.no_se_sabe > 0 ? ` y ${deseable.no_se_sabe} sin verificar` : ""}
        </p>
      ) : null}
      {rebuilt ? (
        <p className="text-xs text-fg-muted">
          Esta oferta se evaluó antes de que existiera esta lista: la armamos con tu perfil, sin los
          requisitos que leyó la IA, y puede estar incompleta.
        </p>
      ) : parcial ? (
        <p className="text-xs text-warning">
          Sin la descripción completa: esta lista sale del resumen del aviso y puede estar
          incompleta.
        </p>
      ) : null}

      <div className="rounded-control bg-surface-subtle p-3" data-testid="requisitos-descarte">
        <p className="text-xs font-bold">Lo primero que mira un reclutador</p>
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
          <p className="text-xs text-fg-subtle">
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
