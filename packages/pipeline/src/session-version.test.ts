import { describe, expect, it } from "vitest";
import { sessionVersionCheck } from "./session-version";

describe("sessionVersionCheck (S-6)", () => {
  it("la misma versión vale; otra, no", () => {
    expect(sessionVersionCheck(3, 3)).toBe("ok");
    expect(sessionVersionCheck(2, 3)).toBe("vencida");
  });

  it("un JWT viejo sin versión cuenta como 0: vale hasta el primer reset", () => {
    expect(sessionVersionCheck(undefined, 0)).toBe("ok");
    expect(sessionVersionCheck(undefined, 1)).toBe("vencida");
    expect(sessionVersionCheck("1", 1)).toBe("vencida");
  });

  it("sin usuario en la base, la sesión se cierra", () => {
    expect(sessionVersionCheck(0, null)).toBe("sin_usuario");
  });
});
