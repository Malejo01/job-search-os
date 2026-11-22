import { describe, expect, it } from "vitest";
import { AUTH_UNVERIFIED_REASON, bucketOfOutcome, UNEXPECTED_SENDER_REASON } from "./handle";

const UNREADABLE = "estructura no reconocida (linkedin): sin tarjetas. Cola manual";

describe("bucketOfOutcome · cupo definitivo", () => {
  it("un email no reconocido sin autenticación verificada cuenta como no esperado", () => {
    expect(bucketOfOutcome(UNREADABLE, null)).toBe("unexpected");
    expect(bucketOfOutcome(UNREADABLE, "none")).toBe("unexpected");
    expect(bucketOfOutcome(AUTH_UNVERIFIED_REASON, "none")).toBe("unexpected");
    expect(bucketOfOutcome(UNEXPECTED_SENDER_REASON, null)).toBe("unexpected");
  });

  it("uno no reconocido con autenticación verificada cuenta como esperado", () => {
    expect(bucketOfOutcome(UNREADABLE, "aligned")).toBe("expected");
  });

  it("lo que el parser reconoció sigue siendo esperado, con o sin veredicto", () => {
    expect(bucketOfOutcome(null, null)).toBe("expected");
    expect(bucketOfOutcome(null, "aligned")).toBe("expected");
    expect(bucketOfOutcome("usuario sin criterios activos", "none")).toBe("expected");
  });
});
