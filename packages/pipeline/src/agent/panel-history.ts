import type { ManualJobEvent } from "../status";
import type { ActionOutcome, AgentMessage, ProposalOutcome } from "./history";
import type { ProposalDestination } from "./types";

/**
 * Lo que el panel del asistente arma en memoria para mandar en cada turno (AG-3/AG-5). Puro, para
 * poder testearlo: el panel le pasa sus ítems (tienen más campos; acá se usa solo lo necesario).
 */
export type PanelItem =
  | { turn: number; kind: "user" | "assistant" | "notice" | "error"; text: string }
  | {
      turn: number;
      kind: "proposal";
      proposal: { destination: ProposalDestination; diffs: readonly { field: string }[] };
      status: ProposalOutcome["status"];
    }
  | {
      turn: number;
      kind: "action";
      action: { kind: ActionOutcome["kind"]; event?: ManualJobEvent };
      status: ActionOutcome["status"];
    };

const DESTINATION_NAME: Record<ProposalDestination, string> = {
  profile: "Tu perfil",
  skill_levels: "Tus skills",
  criteria: "Criterios",
  target_roles: "Tus puestos",
};

const ACTION_NAME: Record<ActionOutcome["kind"], string> = {
  status_change: "un cambio de estado",
  new_job: "cargar una oferta",
};

/**
 * Historial para el servidor. Un turno sin respuesta del asistente, ni propuesta, ni acción (CV
 * derivado, tope, error) no entra: así un CV pegado no vuelve a viajar en el turno siguiente y los
 * roles siguen alternando.
 */
export function historyFrom(items: readonly PanelItem[]): AgentMessage[] {
  const turns = new Map<number, PanelItem[]>();
  for (const item of items) turns.set(item.turn, [...(turns.get(item.turn) ?? []), item]);
  const out: AgentMessage[] = [];
  for (const group of turns.values()) {
    const user = group.find((i) => i.kind === "user");
    if (!user || user.kind !== "user") continue;
    const text = group
      .map((i) => (i.kind === "assistant" ? i.text : ""))
      .join("")
      .trim();
    const proposals = group.flatMap((i) =>
      i.kind === "proposal" ? [DESTINATION_NAME[i.proposal.destination]] : [],
    );
    const actions = group.flatMap((i) => (i.kind === "action" ? [ACTION_NAME[i.action.kind]] : []));
    const reply =
      text ||
      (proposals.length > 0
        ? `[Propuse cambios para ${proposals.join(", ")}]`
        : actions.length > 0
          ? `[Propuse ${actions.join(", ")}]`
          : "");
    if (!reply) continue;
    out.push({ role: "user", text: user.text }, { role: "assistant", text: reply.slice(0, 4000) });
  }
  return out;
}

/** Qué pasó con las últimas propuestas de formulario (solo nombres de campo). */
export function proposalOutcomesFrom(items: readonly PanelItem[]): ProposalOutcome[] {
  return items
    .flatMap((i) => (i.kind === "proposal" ? [i] : []))
    .slice(-20)
    .map((i) => ({
      destination: i.proposal.destination,
      fields: i.proposal.diffs.map((d) => d.field).slice(0, 20),
      status: i.status,
    }));
}

/** Qué pasó con las últimas acciones: tipo, evento y si la persona la confirmó o descartó. */
export function actionOutcomesFrom(items: readonly PanelItem[]): ActionOutcome[] {
  return items
    .flatMap((i) => (i.kind === "action" ? [i] : []))
    .slice(-20)
    .map((i) => ({
      kind: i.action.kind,
      ...(i.action.event ? { event: i.action.event } : {}),
      status: i.status,
    }));
}
