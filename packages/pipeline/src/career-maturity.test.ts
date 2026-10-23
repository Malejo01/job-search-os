import { describe, expect, it } from "vitest";
import { careerMaturity, careerMaturityBadgeEnabled } from "./career-maturity";

const MADURA = { offersOk: true, thumbsOk: true, activeOk: true };

describe("careerMaturity (C-13)", () => {
  it("con las tres reglas cumplidas, es madura", () => {
    expect(careerMaturity(MADURA)).toBe("madura");
  });

  it("si falla cualquiera de las tres, queda en pulido", () => {
    expect(careerMaturity({ ...MADURA, offersOk: false })).toBe("en_pulido");
    expect(careerMaturity({ ...MADURA, thumbsOk: false })).toBe("en_pulido");
    expect(careerMaturity({ ...MADURA, activeOk: false })).toBe("en_pulido");
  });

  it("sin datos o con la regla de 👍 sin evaluar (pocas personas), falla cerrado", () => {
    expect(careerMaturity(null)).toBe("en_pulido");
    expect(careerMaturity(undefined)).toBe("en_pulido");
    expect(careerMaturity({ ...MADURA, thumbsOk: null })).toBe("en_pulido");
  });

  it("el badge solo se enciende con CAREER_MATURITY_BADGE=1", () => {
    expect(careerMaturityBadgeEnabled({})).toBe(false);
    expect(careerMaturityBadgeEnabled({ CAREER_MATURITY_BADGE: "true" })).toBe(false);
    expect(careerMaturityBadgeEnabled({ CAREER_MATURITY_BADGE: "1" })).toBe(true);
  });
});
