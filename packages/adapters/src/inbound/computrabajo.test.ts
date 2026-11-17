import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { baseDomain, EXPECTED_SOURCE_DOMAINS } from "@job-search-os/pipeline";
import { describe, expect, it } from "vitest";
import { computrabajoParser } from "./computrabajo";
import { EMAIL_PARSERS, parserForSenderDomain, type InboundEmailContent } from "./parsers";

/**
 * R11-4 · Parser del mail de recomendaciones de Computrabajo que llega a la casilla de una persona.
 * Fixtures escritas a mano a partir de los esqueletos de la R8-1: empresas, títulos, IDs y tokens
 * inventados. El recordatorio «Volvé a revisar…» y el mail de seguimiento de una empresa no se leen.
 */
const fixture = (name: string) =>
  readFileSync(resolve(__dirname, "fixtures/computrabajo", name), "utf8");

const email = (html: string | null): InboundEmailContent => ({
  // El parser no mira el remitente: el ruteo se prueba más abajo
  from: '"Portal" <avisos@portal.example>',
  to: ["u_a0000000@ingest.example.com"],
  subject: "Avisos para vos",
  html,
  text: null,
  receivedAt: new Date("2026-11-13T09:00:00Z"),
});

const parse = (html: string | null) => computrabajoParser.parse(email(html));
const recomendaciones = fixture("recomendaciones-tres-avisos.html");

describe("computrabajoParser: extrae los avisos", () => {
  it("devuelve un RawJob por tarjeta, en el orden del mail", () => {
    const res = parse(recomendaciones);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.jobs.map((j) => j.title)).toEqual([
      "Analista Contable Ficticio",
      "Asistente de Recursos Humanos – Ficticio",
      "Ejecutivo/a de Ventas Ficticio",
    ]);
    expect(res.jobs.map((j) => j.companyRaw)).toEqual([
      "Empresa A",
      "Empresa B & Asociados",
      "Empresa C",
    ]);
  });

  it("el ID y la URL del aviso salen del tracker, sin parámetros", () => {
    const res = parse(recomendaciones);
    if (!res.ok) throw new Error(res.reason);
    expect(res.jobs[0]!.source).toEqual({
      kind: "email_generic",
      name: "Computrabajo (email)",
      externalId: "0A1B2C3D4E5F60718293A4B5C6D7E801",
      url: "https://ar.computrabajo.com/ofertas-de-trabajo/oferta-de-trabajo-de-analista-contable-ficticio-0A1B2C3D4E5F60718293A4B5C6D7E801",
      rawRef: null,
    });
    // Otro país en el subdominio, y un link sin parámetros
    expect(res.jobs[2]!.source.url).toBe(
      "https://mx.computrabajo.com/ofertas-de-trabajo/oferta-de-trabajo-de-ejecutivo-a-de-ventas-ficticio-0A1B2C3D4E5F60718293A4B5C6D7E803",
    );
  });

  it("ningún dato de la persona del tracker llega al RawJob", () => {
    const res = parse(recomendaciones);
    if (!res.ok) throw new Error(res.reason);
    const json = JSON.stringify(res.jobs);
    for (const rastro of ["TOKENFICTICIO", "USUARIOFICTICIO", "utm_", "go.computrabajo.com"]) {
      expect(json).not.toContain(rastro);
    }
  });

  it("lo que el mail no dice queda null (países incluidos)", () => {
    const res = parse(recomendaciones);
    if (!res.ok) throw new Error(res.reason);
    expect(res.jobs[0]).toMatchObject({
      locationRaw: "Ciudad Ficticia, Provincia Ficticia",
      countriesAllowed: null,
      modality: "desconocida",
      contractType: null,
      salaryMinUsd: null,
      salaryMaxUsd: null,
      salaryPeriod: null,
      salaryNote: null,
      weeklyHours: null,
      candidatesCount: null,
      jdText: null,
      postedAt: null,
      seniority: null,
      lang: null,
      badges: [],
      tags: [],
    });
  });

  it("una ubicación vacía queda null", () => {
    const res = parse(recomendaciones);
    if (!res.ok) throw new Error(res.reason);
    expect(res.jobs[2]!.locationRaw).toBeNull();
  });

  it("la calificación de la empresa (span) no ensucia el nombre, y se decodifican entidades", () => {
    const res = parse(recomendaciones);
    if (!res.ok) throw new Error(res.reason);
    expect(res.jobs[1]!.companyRaw).toBe("Empresa B & Asociados");
    expect(res.jobs[1]!.title).toBe("Asistente de Recursos Humanos – Ficticio");
  });
});

describe("computrabajoParser: falla cerrado", () => {
  it("sin HTML", () => {
    expect(parse(null)).toEqual({ ok: false, reason: expect.stringContaining("sin HTML") });
  });

  it("el recordatorio «Volvé a revisar estos trabajos»", () => {
    expect(parse(fixture("recordatorio-volve-a-revisar.html"))).toEqual({
      ok: false,
      reason: expect.stringContaining("recordatorio"),
    });
  });

  it("el recordatorio sin su texto de cabecera sigue sin leerse (las tarjetas no son un link)", () => {
    const sinTexto = fixture("recordatorio-volve-a-revisar.html").replace(
      /Volvé a revisar estos trabajos, aún estás a tiempo de enviar tu CV/,
      "Novedades",
    );
    expect(parse(sinTexto).ok).toBe(false);
  });

  it("el mail en que una empresa revisó tu CV (sin tarjetas)", () => {
    expect(parse(fixture("empresa-vio-tu-cv.html")).ok).toBe(false);
  });

  it("estructura cambiada: se renombra la clase del título", () => {
    expect(parse(recomendaciones.replace(/title_oferta/g, "titulo")).ok).toBe(false);
  });

  it("estructura cambiada: a una tarjeta le falta la línea de ubicación", () => {
    const roto = recomendaciones.replace(
      /<tr>\s*<td class="texto_oferta"[^>]*>Ciudad Ficticia, Provincia Ficticia<\/td>\s*<\/tr>/,
      "",
    );
    expect(roto).not.toBe(recomendaciones);
    expect(parse(roto).ok).toBe(false);
  });

  it("estructura cambiada: una línea de texto de más", () => {
    const roto = recomendaciones.replace(
      '<td style="font-size: 14px;color: #4B5968;">Hoy</td>',
      '<td class="texto_oferta">Sueldo a convenir</td>',
    );
    expect(roto).not.toBe(recomendaciones);
    expect(parse(roto).ok).toBe(false);
  });

  it("un título fuera de una tarjeta con link", () => {
    const roto = recomendaciones.replace(
      "<body ",
      '<body><table><tr><td class="title_oferta"><strong>Suelto</strong></td></tr></table><div ',
    );
    expect(parse(roto).ok).toBe(false);
  });

  it("el link de la tarjeta no es del tracker de Computrabajo", () => {
    const roto = recomendaciones.replace(
      "https://go.computrabajo.com/xx/ruta-ficticia/aviso?ipo=TOKENFICTICIO&amp;url=https%3A%2F%2Far.computrabajo.com%2Fofertas-de-trabajo%2Foferta-de-trabajo-de-analista",
      "https://sitio-ajeno.example/aviso?url=https%3A%2F%2Far.computrabajo.com%2Fofertas-de-trabajo%2Foferta-de-trabajo-de-analista",
    );
    expect(roto).not.toBe(recomendaciones);
    expect(parse(roto).ok).toBe(false);
  });

  it("el link no apunta a un aviso (sin ID de 32 caracteres)", () => {
    const roto = recomendaciones.replace("-0A1B2C3D4E5F60718293A4B5C6D7E801", "-0A1B2C3D4E5F6071");
    expect(roto).not.toBe(recomendaciones);
    expect(parse(roto).ok).toBe(false);
  });

  it("el destino del link es de otro sitio", () => {
    const roto = recomendaciones.replace(
      "https%3A%2F%2Far.computrabajo.com%2Fofertas-de-trabajo%2Foferta-de-trabajo-de-analista",
      "https%3A%2F%2Fsitio-ajeno.example%2Fofertas-de-trabajo%2Foferta-de-trabajo-de-analista",
    );
    expect(roto).not.toBe(recomendaciones);
    expect(parse(roto).ok).toBe(false);
  });

  it("tarjeta sin empresa", () => {
    const roto = recomendaciones.replace(/(<td class="texto_oferta"[^>]*>)Empresa A\s*/, "$1  ");
    expect(roto).not.toBe(recomendaciones);
    expect(parse(roto).ok).toBe(false);
  });
});

describe("despacho por remitente", () => {
  it.each(["computrabajo.com", "mail.computrabajo.com"])(
    "el dominio %s va al parser de Computrabajo",
    (domain) => {
      expect(parserForSenderDomain(domain)).toBe("computrabajo");
    },
  );

  it("el parser está registrado", () => {
    expect(EMAIL_PARSERS.computrabajo).toBe(computrabajoParser);
  });

  it("un dominio que solo termina parecido no es Computrabajo", () => {
    expect(parserForSenderDomain("notcomputrabajo.com")).toBe("generic");
    expect(parserForSenderDomain("computrabajo.com.example.org")).toBe("generic");
  });

  it("los dominios de país no se rutean sin un esqueleto que los avale", () => {
    expect(parserForSenderDomain("computrabajo.com.ar")).toBe("generic");
  });

  it("Bumeran sigue yendo a su parser", () => {
    expect(parserForSenderDomain("bumeran.com")).toBe("bumeran");
  });

  it("es fuente esperada: el mail se guarda completo y no avisa como fuga", () => {
    expect(EXPECTED_SOURCE_DOMAINS).toContain("computrabajo.com");
    expect(baseDomain("mail.computrabajo.com")).toBe("computrabajo.com");
  });
});
