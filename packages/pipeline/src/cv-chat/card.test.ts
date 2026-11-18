import { describe, expect, it } from "vitest";
import { buildCvUnderstoodCard } from "./card";
import { initialCvChatState } from "./state";
import { parseCvChatState } from "./state-schema";

const proyecto = {
  kind: "proyecto" as const,
  organization: "Proyecto 1",
  title: "Desarrolladora frontend",
  startMonth: "2024-03",
  endMonth: null,
  bullets: ["Armé el tablero de turnos", "Stack: React, Node.js"],
  link: "https://github.com/persona-ficticia/proyecto-1",
};

describe("tarjeta del chat con proyectos (R12-4)", () => {
  it("los proyectos confirmados van en «Proyectos», con rol, fecha, link y stack", () => {
    const s = { ...initialCvChatState(), confirmed: [proyecto] };
    const card = buildCvUnderstoodCard(s);
    expect(card.sections.find((x) => x.id === "projects")).toEqual({
      id: "projects",
      title: "Proyectos",
      items: [
        {
          id: "history:0",
          heading: "Proyecto 1",
          detail:
            "Desarrolladora frontend | 03/2024 | https://github.com/persona-ficticia/proyecto-1",
          bullets: ["Armé el tablero de turnos", "Stack: React, Node.js"],
        },
      ],
    });
    // los proyectos no son obligatorios: sin ellos no hay faltante
    expect(buildCvUnderstoodCard(initialCvChatState()).missing).not.toContain("projects");
  });

  it("sin link, el detalle queda con rol y fecha", () => {
    const s = { ...initialCvChatState(), confirmed: [{ ...proyecto, link: null }] };
    const item = buildCvUnderstoodCard(s).sections.find((x) => x.id === "projects")!.items[0]!;
    expect(item.detail).toBe("Desarrolladora frontend | 03/2024");
  });
});

describe("estado del navegador con proyectos (R12-4)", () => {
  const base = initialCvChatState();

  it("acepta un proyecto con link https, con link null o sin el campo", () => {
    expect(parseCvChatState({ ...base, confirmed: [proyecto] })?.confirmed).toEqual([proyecto]);
    const sinLink = { ...proyecto, link: null };
    expect(parseCvChatState({ ...base, confirmed: [sinLink] })?.confirmed).toEqual([sinLink]);
    const { link: _omit, ...sinCampo } = proyecto;
    expect(parseCvChatState({ ...base, confirmed: [sinCampo] })).not.toBeNull();
  });

  it("rechaza links http, con email o largos, y links fuera de un proyecto", () => {
    for (const link of [
      "http://ejemplo.test/x",
      "persona@ejemplo.test",
      "https://persona@ejemplo.test",
      `https://ejemplo.test/${"x".repeat(180)}`,
      "javascript:alert(1)",
    ]) {
      expect(parseCvChatState({ ...base, confirmed: [{ ...proyecto, link }] }), link).toBeNull();
    }
    expect(
      parseCvChatState({
        ...base,
        confirmed: [{ ...proyecto, kind: "trabajo", link: "https://ejemplo.test/x" }],
      }),
    ).toBeNull();
  });
});
