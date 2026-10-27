import { describe, expect, it } from "vitest";
import { isProposeOutput, proposeModelText } from "./propose-output";
import type { Proposal } from "./types";

const proposal: Proposal = {
  destination: "profile",
  href: "/settings/perfil",
  title: "Cambios para Tu perfil",
  diffs: [
    {
      field: "city",
      label: "Ciudad",
      before: "Ciudad Vieja Inventada",
      after: "Ciudad Nueva Inventada",
      source: { from: "message", quote: "ahora vivo en Ciudad Nueva Inventada" },
    },
  ],
  formValues: { city: "Ciudad Nueva Inventada" },
  dropped: [{ field: "yearsTotal", reason: "sin_fundamento" }],
  warnings: [],
};

describe("proposeModelText", () => {
  it("al modelo vuelven destino, campos y motivos; nunca valores, citas ni formValues", () => {
    const text = proposeModelText({ ok: true, proposal });
    expect(JSON.parse(text)).toMatchObject({
      propuesta_lista: true,
      destino: "profile",
      cambios: ["city"],
      descartados: [{ field: "yearsTotal", reason: "sin_fundamento" }],
    });
    expect(text).not.toMatch(/Inventada/);
    expect(text).not.toMatch(/vivo en/);
  });

  it("una propuesta que no se armó dice el motivo; lo que no es una salida, tool_fallo", () => {
    expect(
      JSON.parse(
        proposeModelText({
          ok: false,
          code: "sin_cambios",
          dropped: [{ field: "country", reason: "sin_fundamento" }],
        }),
      ),
    ).toEqual({
      propuesta_lista: false,
      motivo: "sin_cambios",
      descartados: [{ field: "country", reason: "sin_fundamento" }],
    });
    expect(JSON.parse(proposeModelText("cualquier cosa"))).toEqual({ error: "tool_fallo" });
    expect(isProposeOutput(null)).toBe(false);
    expect(isProposeOutput({ ok: "si" })).toBe(false);
  });
});
