import { describe, expect, it } from "vitest";
import { recomputeDecision, RECOMPUTE_FLOOR_MS, RECOMPUTE_WINDOW_MS } from "./recompute";

const last = new Date("2026-01-05T10:00:00.000Z");
const at = (ms: number) => new Date(last.getTime() + ms);

describe("recomputeDecision", () => {
  it("sin recálculo previo corre, con o sin cambios", () => {
    for (const inputsChanged of [true, false]) {
      expect(recomputeDecision({ now: last, lastRecomputeAt: null, inputsChanged })).toEqual({
        run: true,
      });
    }
  });

  it("menos de 10 segundos: no corre, aunque haya cambios", () => {
    expect(
      recomputeDecision({
        now: at(RECOMPUTE_FLOOR_MS - 1),
        lastRecomputeAt: last,
        inputsChanged: true,
      }),
    ).toEqual({ run: false, reason: "piso" });
  });

  it("exactamente 10 segundos con cambios corre", () => {
    expect(
      recomputeDecision({
        now: at(RECOMPUTE_FLOOR_MS),
        lastRecomputeAt: last,
        inputsChanged: true,
      }),
    ).toEqual({ run: true });
  });

  it("exactamente 10 segundos sin cambios queda en la ventana", () => {
    expect(
      recomputeDecision({
        now: at(RECOMPUTE_FLOOR_MS),
        lastRecomputeAt: last,
        inputsChanged: false,
      }),
    ).toEqual({ run: false, reason: "ventana" });
  });

  it("a los 5 minutos sin cambios: ventana", () => {
    expect(
      recomputeDecision({ now: at(5 * 60_000), lastRecomputeAt: last, inputsChanged: false }),
    ).toEqual({ run: false, reason: "ventana" });
  });

  it("a los 5 minutos con cambios: corre", () => {
    expect(
      recomputeDecision({ now: at(5 * 60_000), lastRecomputeAt: last, inputsChanged: true }),
    ).toEqual({ run: true });
  });

  it("justo antes de los 10 minutos sin cambios sigue en la ventana; a los 10 corre", () => {
    expect(
      recomputeDecision({
        now: at(RECOMPUTE_WINDOW_MS - 1),
        lastRecomputeAt: last,
        inputsChanged: false,
      }),
    ).toEqual({ run: false, reason: "ventana" });
    expect(
      recomputeDecision({
        now: at(RECOMPUTE_WINDOW_MS),
        lastRecomputeAt: last,
        inputsChanged: false,
      }),
    ).toEqual({ run: true });
  });

  it("con el reloj hacia atrás no corre", () => {
    expect(
      recomputeDecision({ now: at(-5_000), lastRecomputeAt: last, inputsChanged: true }),
    ).toEqual({ run: false, reason: "piso" });
  });
});
