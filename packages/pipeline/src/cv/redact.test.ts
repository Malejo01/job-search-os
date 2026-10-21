import { describe, expect, it } from "vitest";
import { findCvSensitive, redactCvText, stripCvUrls } from "./redact";

const redact = (text: string, displayName?: string) => {
  const r = redactCvText(text, { displayName });
  if (!r.ok) throw new Error(`redacción falló: ${r.error}`);
  return r.value;
};

describe("redactCvText", () => {
  it("email", () => {
    const r = redact("Escribime a persona.ficticia@example.com cuando quieras");
    expect(r.text).toBe("Escribime a [email] cuando quieras");
    expect(r.counts.email).toBe(1);
  });

  it.each([
    "+54 " + "9 351 555-0000",
    "+54 " + "9 351 5550000",
    "0299 15 555 0000",
    "0299 15-555-0000",
    "11 1234-5678",
    "(011) 4123-4567",
    "11-1234-5678",
    "299 555-0000",
    "+1 (415) 555-0100",
    "2995550000",
  ])("teléfono %s", (phone) => {
    const r = redact(`Tel: ${phone}. Gracias`);
    expect(r.text).toBe("Tel: [teléfono]. Gracias");
    expect(r.counts.phone).toBe(1);
  });

  it("URLs y dominios con ruta", () => {
    const r = redact(
      "Perfil: linkedin.com/" +
        "in/ejemplo-uno y https://example.com/cv, www.example.com/x. Repo github.com/persona",
    );
    expect(r.text).toBe("Perfil: [link] y [link], [link]. Repo [link]");
    expect(r.counts.url).toBe(4);
  });

  it("no toca Node.js/Express ni CI/CD", () => {
    const text = "Stack: Node.js/Express, CI/CD, ASP.NET y React.js";
    expect(redact(text).text).toBe(text);
  });

  it.each([
    "D" + "NI 22.333.444",
    "D.N.I. 22.333.444",
    "D" + "NI: 22333444",
    "DNI N° 22.333.444",
    "CU" + "IL 27-" + "22333444-1",
    "CU" + "IT: 27223334441",
    "27-" + "22333444-1",
    "123.456.789-09",
    "22.333.444-5",
  ])("documento %s", (doc) => {
    const r = redact(`Datos: ${doc} fin`);
    expect(r.text).toBe("Datos: [documento] fin");
    expect(r.counts.national_id).toBe(1);
  });

  it("pasaporte con la palabra, no una palabra común", () => {
    expect(redact("Pasaporte: AAB123456 vigente").text).toBe("[documento] vigente");
    expect(redact("Passport No. X1234567").text).toBe("[documento]");
    const plain = "Tramité el pasaporte electrónico de la empresa";
    expect(redact(plain).text).toBe(plain);
  });

  it.each([
    ["Vivo en Av. Siempre Viva 742, Ciudad Ficticia", "Vivo en [dirección], Ciudad Ficticia"],
    ["Calle Falsa 123", "[dirección]"],
    ["Domicilio: Pasaje Ficticio s/n, Ciudad Ficticia\nOtra línea", "[dirección]\nOtra línea"],
  ])("dirección %j", (input, expected) => {
    const r = redact(input);
    expect(r.text).toBe(expected);
    expect(r.counts.address).toBe(1);
  });

  it.each([
    "Fecha de nacimiento: 12/03/1990",
    "Nacido el 12 de marzo de 1990",
    "Nacida el 12-03-1990",
    "Born March 12, 1990",
    "DOB: 1990-03-12",
    "D.O.B. 12.03.1990",
  ])("fecha de nacimiento %s", (input) => {
    const r = redact(`${input} y sigo`);
    expect(r.text).toBe("[fecha de nacimiento] y sigo");
    expect(r.counts.birth_date).toBe(1);
  });

  it.each([
    ["Edad: 32 años", "[edad]"],
    ["Edad: 32", "[edad]"],
    ["32 años de edad", "[edad]"],
    ["Age: 32", "[edad]"],
    ["32 years old", "[edad]"],
  ])("edad %s", (input, expected) => {
    const r = redact(input);
    expect(r.text).toBe(expected);
    expect(r.counts.age).toBe(1);
  });

  it.each([
    ["Estado civil: soltera", "[estado civil]"],
    ["Casado/a, con hijos", "[estado civil], con hijos"],
    ["Soy divorciado", "Soy [estado civil]"],
    ["viuda", "[estado civil]"],
  ])("estado civil %s", (input, expected) => {
    const r = redact(input);
    expect(r.text).toBe(expected);
    expect(r.counts.marital_status).toBe(1);
  });

  it("nombre de la cuenta, con y sin acentos, en cualquier caso", () => {
    const r = redact("SOFIA EJEMPLO\nSofia ejemplo, soy sofia ejemplo", "Sofia Ejemplo");
    expect(r.text).toBe("[nombre]\n[nombre], soy [nombre]");
    const acc = redact("Álvaro Núñez-Pérez trabajó con alvaro", "Alvaro Nunez");
    expect(acc.text).toBe("[nombre]-Pérez trabajó con [nombre]");
    expect(redact("Nuñez, Álvaro", "Alvaro Nuñez").text).toBe("[nombre], [nombre]");
  });

  it("sin displayName no saca nombres", () => {
    expect(redact("Persona Ficticia").text).toBe("Persona Ficticia");
  });

  it("no toca rangos de años ni años de experiencia", () => {
    const text =
      "Empresa Ficticia, 2019 – 2023. Otra, 03/2020 - 06/2022. 2018-2021 y 2018 2019-2021. " +
      "5 años de experiencia en QA y 10 años en soporte.";
    const r = redact(text);
    expect(r.text).toBe(text);
    expect(r.counts).toEqual({});
  });

  it("no toca métricas con puntos", () => {
    const text = "Atendí a 10.000.000 de usuarios y 1.500 tickets";
    expect(redact(text).text).toBe(text);
  });

  it("falla cerrado si queda un resto", () => {
    // El marcador "[nombre]" coincide con una parte del nombre de la cuenta: el chequeo final lo ve.
    const r = redactCvText("Nombre Ficticio trabajó en Empresa Ficticia", {
      displayName: "Nombre Ficticio",
    });
    expect(r).toEqual({ ok: false, error: "redaction_failed" });
  });
});

describe("findCvSensitive", () => {
  it("devuelve tipos, no texto", () => {
    const kinds = findCvSensitive("Mail a@example.com, D" + "NI 22.333.444, edad: 40");
    expect(kinds.sort()).toEqual(["age", "email", "national_id"]);
  });

  it("texto limpio no devuelve nada", () => {
    expect(findCvSensitive("Backend con Python entre 2019 y 2023, 3 años de experiencia")).toEqual(
      [],
    );
  });

  it("detecta el nombre si se pasa", () => {
    expect(findCvSensitive("hola Persona", { displayName: "Persona Ficticia" })).toEqual([
      "display_name",
    ]);
  });
});

describe("stripCvUrls", () => {
  it("quita URLs sin dejar marcador", () => {
    expect(stripCvUrls("Mirá https://example.com/a y listo")).toBe("Mirá  y listo");
  });
});
