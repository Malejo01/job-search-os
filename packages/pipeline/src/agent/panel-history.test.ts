import { describe, expect, it } from "vitest";
import { summarizeHistory, validateAgentHistory } from "./history";
import {
  actionOutcomesFrom,
  historyFrom,
  proposalOutcomesFrom,
  type PanelItem,
} from "./panel-history";
import { parseAssistantRequest } from "./request";

const items: PanelItem[] = [
  { turn: 0, kind: "user", text: "Me mudé a Uruguay" },
  {
    turn: 0,
    kind: "proposal",
    proposal: { destination: "profile", diffs: [{ field: "country" }] },
    status: "cargada",
  },
  { turn: 1, kind: "user", text: "Ya me postulé a esta" },
  { turn: 1, kind: "action", action: { kind: "status_change", event: "apply" }, status: "enviada" },
  { turn: 2, kind: "user", text: "[CV pegado]" },
  { turn: 2, kind: "notice", text: "Parece que pegaste un CV" },
  { turn: 3, kind: "user", text: "Agregá la oferta X de Y" },
  { turn: 3, kind: "assistant", text: "Te dejé la tarjeta." },
  { turn: 3, kind: "action", action: { kind: "new_job" }, status: "descartada" },
  { turn: 4, kind: "user", text: "¿Y ahora?" },
];

describe("historial del panel", () => {
  it("cada turno con respuesta, propuesta o acción entra; el CV derivado no", () => {
    const history = historyFrom(items);
    expect(history).toEqual([
      { role: "user", text: "Me mudé a Uruguay" },
      { role: "assistant", text: "[Propuse cambios para Tu perfil]" },
      { role: "user", text: "Ya me postulé a esta" },
      { role: "assistant", text: "[Propuse un cambio de estado]" },
      { role: "user", text: "Agregá la oferta X de Y" },
      { role: "assistant", text: "Te dejé la tarjeta." },
    ]);
    // Con el mensaje nuevo, valida como lo exige la ruta
    expect(validateAgentHistory([...history, { role: "user", text: "¿Y ahora?" }]).ok).toBe(true);
  });

  it("propuestas y acciones salen con su estado, sin textos", () => {
    expect(proposalOutcomesFrom(items)).toEqual([
      { destination: "profile", fields: ["country"], status: "cargada" },
    ]);
    expect(actionOutcomesFrom(items)).toEqual([
      { kind: "status_change", event: "apply", status: "enviada" },
      { kind: "new_job", status: "descartada" },
    ]);
  });

  it("la request acepta las acciones y el resumen dice qué hizo la persona", () => {
    const req = parseAssistantRequest({
      conversationId: null,
      messages: [{ role: "user", text: "hola" }],
      actions: actionOutcomesFrom(items),
    });
    expect(req.ok && req.value.actions).toHaveLength(2);
    expect(
      parseAssistantRequest({
        conversationId: null,
        messages: [{ role: "user", text: "hola" }],
        actions: [{ kind: "new_job", status: "enviada", title: "texto libre" }],
      }).ok,
    ).toBe(false);
    const { summary } = summarizeHistory([{ role: "user", text: "hola" }], [], {
      actions: actionOutcomesFrom(items),
    });
    expect(summary).toContain("Acción status_change (apply): la persona la confirmó");
    expect(summary).toContain("Acción new_job: la persona la descartó");
  });
});
