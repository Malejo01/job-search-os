import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { baseDomain, EXPECTED_SOURCE_DOMAINS } from "@job-search-os/pipeline";
import { describe, expect, it } from "vitest";
import { bumeranParser } from "./bumeran";
import {
  chooseParserName,
  EMAIL_PARSERS,
  parserForSenderDomain,
  type InboundEmailContent,
} from "./parsers";

/**
 * R11-3 · Parser del mail «Bumeran te sugiere» (casilla de no responder de bumeran.com). Fixtures escritas a mano a
 * partir del esqueleto de la R8-1: empresas, títulos y links inventados. Los links reales son un
 * tracker por persona (`delivery.bumeran.com`) sin id del aviso: el parser no los guarda.
 */
const fixture = (name: string) =>
  readFileSync(resolve(__dirname, "fixtures/bumeran", name), "utf8");

const email = (html: string | null): InboundEmailContent => ({
  // El parser no mira el remitente: el ruteo se prueba más abajo
  from: '"Portal" <avisos@portal.example>',
  to: ["u_a0000000@ingest.example.com"],
  subject: "¡Analista Contable Ficticio y 2 avisos más!",
  html,
  text: null,
  receivedAt: new Date("2026-11-13T09:00:00Z"),
});

const parse = (html: string | null) => bumeranParser.parse(email(html));
const sugerencias = fixture("sugerencias-tres-avisos.html");

describe("bumeranParser: extrae los avisos", () => {
  it("devuelve un RawJob por tarjeta, en el orden del mail", () => {
    const res = parse(sugerencias);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.jobs.map((j) => j.title)).toEqual([
      "Analista Contable Ficticio",
      "Ejecutivo/a de Cuentas & Ventas Ficticio",
      "Asistente de Recursos Humanos Ficticio",
    ]);
    expect(res.jobs.map((j) => j.companyRaw)).toEqual([
      "Empresa A",
      "Empresa confidencial",
      "Empresa B",
    ]);
  });

  it("ubicación, contrato y modalidad salen de la tarjeta; el resto queda null", () => {
    const res = parse(sugerencias);
    if (!res.ok) throw new Error(res.reason);
    expect(res.jobs[0]).toMatchObject({
      source: { kind: "email_generic", name: "Bumeran (email)", externalId: null, rawRef: null },
      locationRaw: "Capital Federal, Buenos Aires",
      contractType: "Full-time",
      modality: "hibrido",
      // El mail no dice desde qué países se contrata: null, nunca «cualquiera»
      countriesAllowed: null,
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
    expect(res.jobs[1]).toMatchObject({ modality: "remoto", contractType: "Part-time" });
    expect(res.jobs[2]).toMatchObject({ modality: "presencial", locationRaw: "Córdoba, Córdoba" });
  });

  it("una ubicación vacía queda null (no se inventa)", () => {
    const res = parse(sugerencias);
    if (!res.ok) throw new Error(res.reason);
    expect(res.jobs[1]!.locationRaw).toBeNull();
  });

  it("no guarda el link del mail: es un tracker con un id de la persona", () => {
    const res = parse(sugerencias);
    if (!res.ok) throw new Error(res.reason);
    for (const job of res.jobs) {
      expect(job.source.url).toBeNull();
      expect(JSON.stringify(job)).not.toContain("token-ficticio");
    }
  });

  it("decodifica entidades y acentos", () => {
    const res = parse(sugerencias);
    if (!res.ok) throw new Error(res.reason);
    expect(res.jobs[1]!.title).toContain("&");
    expect(res.jobs[2]!.title).not.toContain("&amp;");
  });

  it("el distintivo de empresa verificada (segundo span) no ensucia el nombre", () => {
    const res = parse(sugerencias);
    if (!res.ok) throw new Error(res.reason);
    expect(res.jobs[0]!.companyRaw).toBe("Empresa A");
  });

  it("un mail con una sola tarjeta también sirve", () => {
    const una = sugerencias.replace(
      /<div style=" margin-bottom: 16px;">[\s\S]*?<\/a>\s*<\/div>\s*<\/div>/g,
      "",
    );
    const res = parse(una);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.jobs).toHaveLength(1);
  });
});

describe("bumeranParser: falla cerrado", () => {
  it("sin HTML", () => {
    expect(parse(null)).toEqual({ ok: false, reason: expect.stringContaining("sin HTML") });
  });

  it("estructura cambiada: a una tarjeta le falta una línea (modalidad)", () => {
    const roto = sugerencias.replace(
      /<p style="margin: 4px 0px 0px; font-size: 14px; font-weight: 400;">\s*<span> Híbrido <\/span>\s*<\/p>/,
      "",
    );
    expect(roto).not.toBe(sugerencias);
    expect(parse(roto).ok).toBe(false);
  });

  it("estructura cambiada: la tarjeta pierde el título (<h3>)", () => {
    const roto = sugerencias.replace(/<h3/g, "<h4").replace(/<\/h3>/g, "</h4>");
    expect(parse(roto).ok).toBe(false);
  });

  it("estructura cambiada: una línea de más en una tarjeta", () => {
    const roto = sugerencias.replace(
      /(<span> Presencial <\/span>\s*<\/p>)/,
      "$1<p><span> Sueldo a convenir </span></p>",
    );
    expect(roto).not.toBe(sugerencias);
    expect(parse(roto).ok).toBe(false);
  });

  it("una modalidad que no conocemos no se adivina", () => {
    expect(parse(sugerencias.replace("Presencial", "Itinerante")).ok).toBe(false);
  });

  it("un título (h3) fuera de una tarjeta con link: formato desconocido", () => {
    const roto = sugerencias.replace("<body>", "<body><h3>Otro título suelto</h3>");
    expect(parse(roto).ok).toBe(false);
  });

  it("el link de la tarjeta no es del tracker de Bumeran", () => {
    const roto = sugerencias.replace(
      "https://delivery.bumeran.com/ruta-ficticia?id=1=token-ficticio-1",
      "https://sitio-ajeno.example/ruta?id=1",
    );
    expect(parse(roto).ok).toBe(false);
  });

  it("falta el encabezado de «Bumeran te sugiere»", () => {
    expect(parse(sugerencias.replace("Bumeran te sugiere", "Novedades")).ok).toBe(false);
  });

  it("tarjeta sin empresa", () => {
    const roto = sugerencias.replace(/<span> Empresa A <\/span><span>/, "<span>  </span><span>");
    expect(parse(roto).ok).toBe(false);
  });

  it("un mail de Bumeran que no es de avisos: invitación de una empresa", () => {
    expect(parse(fixture("invitacion-de-empresa.html"))).toEqual({
      ok: false,
      reason: expect.any(String),
    });
  });

  it("un mail de Bumeran que no es de avisos: bienvenida sin tarjetas", () => {
    expect(parse(fixture("bienvenida-sin-avisos.html")).ok).toBe(false);
  });
});

describe("despacho por remitente", () => {
  it.each(["bumeran.com", "mail.bumeran.com", "bumeran.com.ar", "mail.bumeran.com.ar"])(
    "el dominio %s va al parser de Bumeran",
    (domain) => {
      expect(parserForSenderDomain(domain)).toBe("bumeran");
    },
  );

  it("chooseParserName saca el dominio de la dirección y lo despacha igual", () => {
    expect(chooseParserName('"Portal" <avisos@portal.example>')).toBe("generic");
    expect(chooseParserName("avisos@mail.indeed.com")).toBe("indeed");
  });

  it("el parser está registrado", () => {
    expect(EMAIL_PARSERS.bumeran).toBe(bumeranParser);
  });

  it("un dominio que solo termina parecido no es Bumeran", () => {
    expect(parserForSenderDomain("notbumeran.com")).toBe("generic");
    expect(parserForSenderDomain("bumeran.com.example.org")).toBe("generic");
  });

  it("los dominios de Bumeran son fuente esperada: el mail se guarda completo y no avisa como fuga", () => {
    expect(EXPECTED_SOURCE_DOMAINS).toEqual(
      expect.arrayContaining(["bumeran.com", "bumeran.com.ar"]),
    );
    expect(baseDomain("mail.bumeran.com")).toBe("bumeran.com");
    expect(baseDomain("mail.bumeran.com.ar")).toBe("bumeran.com.ar");
  });

  it("ZonaJobs sigue sin parser: no hay un esqueleto de ese portal", () => {
    expect(parserForSenderDomain("zonajobs.com.ar")).toBe("generic");
  });
});
