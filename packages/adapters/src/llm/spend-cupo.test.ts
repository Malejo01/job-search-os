import { describe, expect, it } from "vitest";
import { globalCapReached } from "./spend";

const CAP = 10;

describe("globalCapReached", () => {
  it("con el tope global alcanzado frena a todas las personas", () => {
    expect(globalCapReached({ capUsd: CAP, totalUsd: 10, mineUsd: 0 })).toBe(true);
    expect(globalCapReached({ capUsd: CAP, totalUsd: 12, mineUsd: 5 })).toBe(true);
  });

  it("por debajo de la parte reservada no frena a nadie", () => {
    expect(globalCapReached({ capUsd: CAP, totalUsd: 7.9, mineUsd: 7.9 })).toBe(false);
  });

  it("en la parte reservada frena a quien ya gastó más que su piso", () => {
    expect(globalCapReached({ capUsd: CAP, totalUsd: 8, mineUsd: 8 })).toBe(true);
    expect(globalCapReached({ capUsd: CAP, totalUsd: 9, mineUsd: 0.5 })).toBe(true);
  });

  it("en la parte reservada deja seguir a quien casi no gastó", () => {
    expect(globalCapReached({ capUsd: CAP, totalUsd: 8, mineUsd: 0 })).toBe(false);
    expect(globalCapReached({ capUsd: CAP, totalUsd: 9.9, mineUsd: 0.49 })).toBe(false);
  });

  it("con el tope en 0 no frena", () => {
    expect(globalCapReached({ capUsd: 0, totalUsd: 100, mineUsd: 100 })).toBe(false);
  });

  it("un valor inválido frena", () => {
    expect(globalCapReached({ capUsd: CAP, totalUsd: Number.NaN, mineUsd: 0 })).toBe(true);
    expect(globalCapReached({ capUsd: CAP, totalUsd: 1, mineUsd: Number.NaN })).toBe(true);
  });
});
