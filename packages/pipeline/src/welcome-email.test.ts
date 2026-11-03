import { describe, expect, it } from "vitest";
import { buildWelcomeEmail, isPlanActivation } from "./welcome-email";

const now = new Date("2026-11-26T15:00:00Z");

describe("isPlanActivation (C8-7: una sola vez por activación)", () => {
  it("de gratis a la beta es una activación", () => {
    expect(isPlanActivation({ plan: "gratis", planUntil: null }, now)).toBe(true);
  });
  it("con la beta vencida, volver a activarla también", () => {
    expect(
      isPlanActivation({ plan: "lista", planUntil: new Date("2026-11-20T00:00:00Z") }, now),
    ).toBe(true);
  });
  it("renovar un plan vigente (o el doble clic del admin) no es una activación", () => {
    expect(
      isPlanActivation({ plan: "lista", planUntil: new Date("2026-12-20T00:00:00Z") }, now),
    ).toBe(false);
  });
});

describe("buildWelcomeEmail", () => {
  const base = {
    displayName: "Ana María Pérez",
    until: new Date("2026-12-26T15:00:00Z"),
    becado: false,
    appUrl: "https://ejemplo.test",
    contactEmail: "hola@ejemplo.test",
    cvEnabled: true,
  };

  it("dice qué hacer primero (los 4 pasos), cuándo vence y cómo pedir ayuda", () => {
    const { subject, text } = buildWelcomeEmail(base);
    expect(subject).toBe("Te damos la bienvenida a la Beta de AfinIAJobs");
    expect(text).toContain("Hola Ana:");
    expect(text).toContain("1. Completá tu perfil");
    expect(text).toContain("https://ejemplo.test/settings/perfil");
    expect(text).toContain("2. Elegí tus áreas");
    expect(text).toContain("3. Pegá una oferta");
    expect(text).toContain("4. Armá tu CV");
    expect(text).toContain("26 de diciembre");
    expect(text).toContain("Contanos qué pasó");
    expect(text).toContain("hola@ejemplo.test");
    expect(text).toContain("https://ejemplo.test/ayuda");
  });

  it("sin el chat de CV, tres pasos; sin contacto, no inventa un email", () => {
    const { text } = buildWelcomeEmail({ ...base, cvEnabled: false, contactEmail: null });
    expect(text).not.toContain("Armá tu CV");
    expect(text).not.toMatch(/escribinos a/);
  });

  it("becado: lo dice sin hablar de pago", () => {
    const { subject, text } = buildWelcomeEmail({ ...base, becado: true });
    expect(subject).toContain("Beta");
    expect(text).toContain("Tu mes de beca");
    expect(text).not.toMatch(/pag(o|á|ar)/i);
  });

  it("no promete ni da precio; el HTML lleva la marca y escapa el nombre", () => {
    const { text, html } = buildWelcomeEmail({ ...base, displayName: "<b>X</b>" });
    expect(text).not.toMatch(/\$|ARS|garantiz/i);
    expect(html).toContain("AfinIA");
    expect(html).not.toContain("<b>X</b>");
  });
});
