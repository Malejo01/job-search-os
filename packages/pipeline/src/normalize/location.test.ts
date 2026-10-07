import { describe, expect, it } from "vitest";
import { normalizeLocation } from "./location";

describe("normalizeLocation", () => {
  it.each([
    ["Buenos Aires, Argentina", "buenos aires, argentina"],
    ["  Córdoba   Capital ", "cordoba capital"],
    ["Argentina (En remoto)", "argentina"],
    ["Latam - Remote", "latam"],
    ["Remoto, Argentina", "argentina"],
    ["Mexico [Híbrido]", "mexico"],
  ])("%j → %j", (input, expected) => {
    expect(normalizeLocation(input)).toBe(expected);
  });

  it.each([null, undefined, "", "   ", "Remoto", "Remote", "(Remoto)", " - "])(
    "%j no dice nada → null",
    (input) => {
      expect(normalizeLocation(input)).toBeNull();
    },
  );
});
