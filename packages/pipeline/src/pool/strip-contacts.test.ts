import { describe, expect, it } from "vitest";
import { stripContacts } from "./strip-contacts";

describe("stripContacts", () => {
  it("reemplaza emails", () => {
    expect(stripContacts("Escribí a talento@example.com con tu CV.")).toBe(
      "Escribí a [contacto] con tu CV.",
    );
    expect(stripContacts("a.b+c@sub.example.com y otro_x@example.com")).toBe(
      "[contacto] y [contacto]",
    );
  });

  it("no deja mailto: colgando", () => {
    const out = stripContacts(
      "Contacto: mailto:rrhh@example.com o <a href='mailto:rrhh@example.com'>acá</a>",
    );
    expect(out).not.toMatch(/mailto/i);
    expect(out).toBe("Contacto: [contacto] o <a href='[contacto]'>acá</a>");
  });

  it("reemplaza teléfonos con distintos separadores", () => {
    const cases = [
      "+44 20 7946 0958",
      "+44 (20) 7946-0958",
      "(020) 7946-0958",
      "555.123.4567",
      "5551234567",
      "+1 555 010 0199",
    ];
    for (const phone of cases) {
      expect(stripContacts(`Llamá al ${phone} hoy`), phone).toBe("Llamá al [contacto] hoy");
    }
  });

  it("reemplaza un teléfono con prefijo tel:", () => {
    expect(stripContacts("tel:+44 20 7946 0958")).toBe("[contacto]");
  });

  it("no toca años, rangos de años ni fechas", () => {
    for (const text of [
      "Experiencia 2020-2024 en el rubro",
      "De 2018 a 2024",
      "2018 2020 2022",
      "Desde 2020 – 2024",
      "Publicado el 2026-10-12",
      "Fecha límite 12/10/2026",
    ]) {
      expect(stripContacts(text), text).toBe(text);
    }
  });

  it("no toca montos ni rangos de horas ni versiones", () => {
    for (const text of [
      "Pago de 1,500–1,900 mensuales",
      "Rango 1.500 - 1.900",
      "Horario 09:00-18:00",
      "Horario 10.30 - 18.30",
      "Usamos v1.2.3 de la librería",
      "Node 20.11.1 o superior",
      "Servidor 192.168.0.1",
      "Hasta 40 horas semanales, 5 días",
    ]) {
      expect(stripContacts(text), text).toBe(text);
    }
  });

  it("no toca rangos salariales sin separador de miles", () => {
    for (const text of [
      "Pago 3000-4000 por mes",
      "Pago 3000 - 4000 por mes",
      "Rango 80000 - 100000 anual",
      "Rango 100 000 - 120 000 anual",
      "Rango 3000–4000 por mes",
      "Rango 80000 – 100000 anual",
    ]) {
      expect(stripContacts(text), text).toBe(text);
    }
    // Los teléfonos con guion siguen saliendo
    expect(stripContacts("Tel +44 20 7946-0958 ya")).toBe("Tel [contacto] ya");
    expect(stripContacts("Tel 555-123-4567 ya")).toBe("Tel [contacto] ya");
  });

  it("deja intacto un texto sin contactos y maneja vacío", () => {
    const text = "Buscamos backend con Node y PostgreSQL.\nRemoto.";
    expect(stripContacts(text)).toBe(text);
    expect(stripContacts("")).toBe("");
  });

  it("mezcla email, teléfono y texto normal", () => {
    expect(
      stripContacts(
        "Equipo de 5 personas. Mail: hr@example.com, tel +44 20 7946 0958. Años 2020-2024.",
      ),
    ).toBe("Equipo de 5 personas. Mail: [contacto], tel [contacto]. Años 2020-2024.");
  });
});
