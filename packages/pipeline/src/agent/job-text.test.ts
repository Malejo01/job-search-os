import { describe, expect, it } from "vitest";
import { redactJobContacts } from "./job-text";

describe("redactJobContacts", () => {
  it("reemplaza emails, links y teléfonos por marcadores", () => {
    const jd = [
      "Empresa Ficticia busca dev React.",
      "Mandá tu CV a rrhh@example.com o a talento.ar@ejemplo.com.ar.",
      "Más info en https://ejemplo.com/empleos?id=4 y www.ejemplo.org",
      "Postulate en careers.ejemplo.io/jobs/123",
      "Llamá al +1 555 0100 123 o al (011) 5555-0101.",
    ].join("\n");
    const out = redactJobContacts(jd, 3000);
    expect(out).not.toMatch(/@/);
    expect(out).not.toMatch(/https?:|www\.|ejemplo\.io/);
    expect(out).not.toMatch(/555/);
    expect(out).toContain("[email]");
    expect(out).toContain("[link]");
    expect(out).toContain("[tel]");
    expect(out).toContain("Empresa Ficticia busca dev React.");
  });

  it("no toca años, rangos de años, sueldos ni «5 años»", () => {
    const jd =
      "Experiencia 2019 - 2023 o 2020-2024. Sueldo USD 1.500 - 2.500 por mes, o $ 1.500.000. Pedimos 5 años de experiencia.";
    expect(redactJobContacts(jd, 3000)).toBe(jd);
  });

  it("recorta al final y acota el trabajo sobre textos enormes", () => {
    expect(redactJobContacts("a".repeat(5000), 3000)).toHaveLength(3000);
    const t0 = performance.now();
    redactJobContacts(`${"a".repeat(200_000)}@`, 3000);
    redactJobContacts("1 ".repeat(100_000), 3000);
    expect(performance.now() - t0).toBeLessThan(500);
  });
});
