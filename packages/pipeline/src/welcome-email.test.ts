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

  it("R28-04: marca una sola acción principal antes de la lista", () => {
    const { text } = buildWelcomeEmail(base);
    const intro = text.indexOf("Lo primero es el paso 1");
    expect(intro).toBeGreaterThan(-1);
    expect(intro).toBeLessThan(text.indexOf("1. Completá tu perfil"));
    expect(text).not.toContain("en este orden");
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

  it("R27-06: lleva la mascota con URL absoluta, alt y 160 px fijos", () => {
    const { html } = buildWelcomeEmail(base);
    const img = html.match(/<img\b[^>]*>/)?.[0] ?? "";
    expect(img).toContain('src="https://ejemplo.test/mascota/saludando-512.png"');
    expect(img).toMatch(/alt="[^"]+"/);
    expect(img).toContain('height="160"');
    expect(img).toMatch(/width="\d+"/);
    expect((html.match(/<img\b/g) ?? []).length).toBe(1);
  });

  it("la barra final de appUrl no duplica la barra de la imagen", () => {
    const { html } = buildWelcomeEmail({ ...base, appUrl: "https://ejemplo.test/" });
    expect(html).toContain('src="https://ejemplo.test/mascota/saludando-512.png"');
  });

  it("el texto plano no lleva la imagen", () => {
    expect(buildWelcomeEmail(base).text).not.toMatch(/<img|mascota\//);
  });

  it("R28-11: el texto plano no lleva etiquetas y se entiende sin imágenes", () => {
    const { text } = buildWelcomeEmail(base);
    expect(text).not.toMatch(/<[a-z!/][^>]*>/i);
    expect(text).toContain("Lo primero es el paso 1");
    expect(text).toContain("26 de diciembre");
  });

  it("R28-11: el HTML lleva el esquema claro, bgcolor de respaldo y la imagen sobre su fondo", () => {
    const { html } = buildWelcomeEmail(base);
    expect(html).toContain('<meta name="color-scheme" content="light only">');
    expect(html).toContain('bgcolor="#EEEDF9"');
    expect(html).not.toMatch(/<script\b|<link\b|url\(/i);
  });

  it("R28-11: el texto plano no cambia sin que alguien lo note (snapshot)", () => {
    expect(buildWelcomeEmail({ ...base, contactEmail: null }).text).toMatchInlineSnapshot(`
      "Hola Ana:

      Ya tenés tu lugar en la Beta de AfinIAJobs. Gracias por sumarte.

      Lo primero es el paso 1: sin tu perfil no podemos leer las ofertas por vos.
      Los otros pasos pueden esperar:

      1. Completá tu perfil: contanos qué hiciste y qué sabés hacer. Con eso leemos cada oferta.
      https://ejemplo.test/settings/perfil

      2. Elegí tus áreas dentro de tu carrera (si te sirven todas, dejalas todas).
      https://ejemplo.test/settings#puesto

      3. Pegá una oferta que te interese, o esperá: todos los días sumamos ofertas de tu carrera.
      https://ejemplo.test/jobs/new

      4. Armá tu CV respondiendo preguntas simples. Lo revisás antes de usarlo.
      https://ejemplo.test/cv/armar

      Tu acceso llega hasta el 26 de diciembre. Unos días antes te avisamos por email.

      ¿Dudas o algo que no anda? Adentro de la app tocá «Contanos qué pasó» o mirá las preguntas frecuentes:
      https://ejemplo.test/ayuda

      La decisión es siempre tuya: nunca postulamos por vos."
    `);
  });
});
