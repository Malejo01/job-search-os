import { describe, expect, it } from "vitest";
import { nombreDelRevisor } from "../lib/textos-revision";

describe("nombreDelRevisor (R28-10)", () => {
  const otro = "otra-persona@example.com";
  const yo = "tester@example.com";

  it("un admin ve el email del revisor", () => {
    expect(
      nombreDelRevisor({
        reviewerEmail: otro,
        viewerEmail: "admin@example.com",
        viewerIsAdmin: true,
      }),
    ).toBe(otro);
  });

  it("un tester no ve el email de otra cuenta", () => {
    const etiqueta = nombreDelRevisor({
      reviewerEmail: otro,
      viewerEmail: yo,
      viewerIsAdmin: false,
    });
    expect(etiqueta).toBe("Otra persona del equipo");
    expect(etiqueta).not.toContain("@");
  });

  it("un tester se ve a sí mismo como «Vos», sin importar mayúsculas", () => {
    expect(
      nombreDelRevisor({
        reviewerEmail: "Tester@Example.com",
        viewerEmail: yo,
        viewerIsAdmin: false,
      }),
    ).toBe("Vos");
  });

  it("si no se pudo leer el email de quien mira, falla cerrado", () => {
    expect(nombreDelRevisor({ reviewerEmail: yo, viewerEmail: null, viewerIsAdmin: false })).toBe(
      "Otra persona del equipo",
    );
  });

  it("una cuenta borrada se dice igual para todos", () => {
    expect(nombreDelRevisor({ reviewerEmail: null, viewerEmail: yo, viewerIsAdmin: false })).toBe(
      "Cuenta borrada",
    );
    expect(nombreDelRevisor({ reviewerEmail: null, viewerEmail: yo, viewerIsAdmin: true })).toBe(
      "Cuenta borrada",
    );
  });
});
