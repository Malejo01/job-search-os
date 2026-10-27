import { describe, expect, it } from "vitest";
import { cleanCvText, cvRejectReasons, hasLinkOrEmail } from "./verify";

const answers = [
  "Trabajé en Empresa A como analista. Armé reportes en Excel y SQL para 12 sucursales.",
  "Bajé el tiempo de cierre un 30%.",
];

describe("SEC-C25-2: dominio suelto como link", () => {
  it.each([
    "Mirá ejemplo.com",
    "perfil.io/maria",
    "Portfolio en miweb.dev",
    "sitio.com.ar/cv",
    "escribime a hola@ejemplo.test",
    "https://ejemplo.test/x",
    "www.ejemplo.test",
  ])("detecta %s", (t) => {
    expect(hasLinkOrEmail(t)).toBe(true);
  });

  it.each([
    "Node.js y ASP.NET",
    "Next.js, Vue.js y React Native",
    "S.A. de Capital, etc. y similares",
    "Reduje el tiempo un 30%.",
    "Trabajé con Python 3.11 y C#",
  ])("no toca %s", (t) => {
    expect(hasLinkOrEmail(t)).toBe(false);
  });

  it("el verificador rechaza un dominio suelto y la limpieza lo saca", () => {
    expect(cvRejectReasons("Armé reportes, mirá ejemplo.com", answers)).toContain("link_or_email");
    expect(cleanCvText("Armé reportes miweb.dev para sucursales")).toBe(
      "Armé reportes para sucursales",
    );
  });
});

describe("SEC-C25-3: primer token y números en letras", () => {
  it("rechaza un nombre propio inventado al principio", () => {
    expect(cvRejectReasons("Google lideró el cierre de reportes.", answers)).toContain(
      "name_not_in_answers",
    );
    expect(cvRejectReasons("Acme automatizó reportes.", answers)).toContain("name_not_in_answers");
  });

  it("acepta un verbo al principio, esté o no en las respuestas", () => {
    expect(cvRejectReasons("Armé reportes en Excel y SQL.", answers)).toEqual([]);
    expect(cvRejectReasons("Automaticé el cierre mensual.", answers)).toEqual([]);
    expect(cvRejectReasons("Managed monthly reports.", ["monthly reports"])).toEqual([]);
    expect(cvRejectReasons("Reduje el cierre.", answers)).toEqual([]);
    expect(cvRejectReasons("Built monthly reports.", ["monthly reports"])).toEqual([]);
  });

  it("acepta como primer token una palabra que las respuestas ya traían", () => {
    expect(cvRejectReasons("Excel y SQL para sucursales.", answers)).toEqual([]);
  });

  it("rechaza números en letras que no estaban (es y en)", () => {
    for (const t of [
      "Armé reportes para doscientos sucursales.",
      "Armé reportes para veinticinco sucursales.",
      "Armé reportes para mil sucursales.",
      "Built reports for twenty-five branches.",
      "Armé reportes para two branches.",
      "Cerré en treinta días.",
    ]) {
      expect(cvRejectReasons(t, answers), t).toContain("number_not_in_answers");
    }
  });

  it("acepta números en letras que la persona escribió", () => {
    expect(
      cvRejectReasons("Armé reportes para doce sucursales.", [
        ...answers,
        "Los hice para doce sucursales",
      ]),
    ).toEqual([]);
  });

  it("no confunde «una» ni «one» con números", () => {
    expect(cvRejectReasons("Armé una herramienta en Excel.", answers)).toEqual([]);
  });
});
