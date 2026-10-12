import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { companyFromDomain, eightfoldParser } from "./eightfold";
import type { InboundEmailContent } from "./parsers";

/**
 * Parser de los emails de Eightfold ("This job is a match"). Fixtures 100 % sintéticas: tenant,
 * dominio, título, skills y pid inventados. Lo que el email no dice queda null; ante cualquier
 * duda, falla cerrado (cola manual).
 */
const fixture = (name: string) => readFileSync(resolve(__dirname, "fixtures", name), "utf8");

const email = (html: string | null, subject: string | null = "This job is a match") =>
  ({
    from: '"Eightfold" <notifications@mail.eightfold.ai>',
    to: ["u_a0000000@ingest.example.com"],
    subject,
    html,
    text: null,
    receivedAt: new Date("2026-10-09T12:00:00Z"),
  }) satisfies InboundEmailContent;

const parse = (file: string, subject?: string | null) =>
  eightfoldParser.parse(email(fixture(file), subject));

describe("eightfoldParser: un aviso", () => {
  it("extrae título, ubicación, skills, pid, empresa y URL sin tracking", () => {
    const res = parse("eightfold-match.html");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.jobs).toHaveLength(1);
    expect(res.jobs[0]).toMatchObject({
      source: {
        kind: "email_generic",
        name: "Eightfold (email)",
        externalId: "eightfold:empresa-ficticia:900100200300",
        url: "https://empresa-ficticia.eightfold.ai/careers/apply?pid=900100200300&domain=empresa-ficticia.example",
        rawRef: null,
      },
      title: "Analista de Datos Semi Senior",
      companyRaw: "Empresa Ficticia",
      locationRaw: "Buenos Aires,Argentina",
      countriesAllowed: ["AR"],
      modality: "desconocida",
      jdText: null,
      tags: ["SQL", "Power BI", "Python", "Excel"],
      contractType: null,
      salaryMinUsd: null,
      salaryMaxUsd: null,
      salaryNote: null,
      postedAt: null,
    });
  });

  it("la URL guardada no conserva ningún parámetro de tracking", () => {
    const res = parse("eightfold-match.html");
    if (!res.ok) throw new Error(res.reason);
    const url = new URL(res.jobs[0]!.source.url!);
    expect([...url.searchParams.keys()].sort()).toEqual(["domain", "pid"]);
  });

  it("acepta el asunto con prefijo de reenvío", () => {
    expect(parse("eightfold-match.html", "Fwd: This job is a match").ok).toBe(true);
  });

  it("sin Relevant Skills: tags vacías, sin inventar nada", () => {
    const res = parse("eightfold-sin-skills.html");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.jobs[0]!.tags).toEqual([]);
    expect(res.jobs[0]!.locationRaw).toBe("Buenos Aires,Argentina");
  });

  it("una ubicación sin país claro deja countriesAllowed en null", () => {
    const html = fixture("eightfold-match.html").replace(
      "Buenos Aires,Argentina",
      "Springfield,Illinois",
    );
    const res = eightfoldParser.parse(email(html));
    if (!res.ok) throw new Error(res.reason);
    expect(res.jobs[0]!.locationRaw).toBe("Springfield,Illinois");
    expect(res.jobs[0]!.countriesAllowed).toBeNull();
  });

  it("una ubicación con dos países es ambigua: countriesAllowed null", () => {
    const html = fixture("eightfold-match.html").replace(
      "Buenos Aires,Argentina",
      "Argentina / Chile",
    );
    const res = eightfoldParser.parse(email(html));
    if (!res.ok) throw new Error(res.reason);
    expect(res.jobs[0]!.countriesAllowed).toBeNull();
  });

  it("modalidad remota solo si el email lo dice", () => {
    const html = fixture("eightfold-match.html").replace("Buenos Aires,Argentina", "Remote");
    const res = eightfoldParser.parse(email(html));
    if (!res.ok) throw new Error(res.reason);
    expect(res.jobs[0]!.modality).toBe("remoto");
    expect(res.jobs[0]!.countriesAllowed).toBeNull();
  });
});

describe("eightfoldParser: dos avisos", () => {
  it("devuelve un aviso por tarjeta, cada uno con su pid", () => {
    const res = parse("eightfold-dos-avisos.html", "2 jobs are a match");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.jobs.map((j) => j.source.externalId)).toEqual([
      "eightfold:empresa-ficticia:900100200300",
      "eightfold:empresa-ficticia:900100200301",
    ]);
    expect(res.jobs.map((j) => j.title)).toEqual([
      "Analista de Datos Semi Senior",
      "Soporte Técnico Nivel 2",
    ]);
    expect(res.jobs[1]!.tags).toEqual(["Active Directory", "Redes"]);
    expect(res.jobs[1]!.modality).toBe("remoto");
  });

  it("si una tarjeta falla, falla el email entero (nunca extracción parcial)", () => {
    const html = fixture("eightfold-dos-avisos.html").replace(
      "<h2>Soporte Técnico Nivel 2</h2>",
      "",
    );
    const res = eightfoldParser.parse(email(html));
    expect(res.ok).toBe(false);
  });

  it("dos botones al mismo pid no se cuentan como dos avisos", () => {
    const html = fixture("eightfold-match.html").replace(
      "</table>",
      `<tr><td><a href="https://empresa-ficticia.eightfold.ai/careers/apply?pid=900100200300&amp;domain=empresa-ficticia.example&amp;trk=otro">Apply Now</a></td></tr></table>`,
    );
    const res = eightfoldParser.parse(email(html));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.jobs).toHaveLength(1);
  });
});

describe("eightfoldParser: falla cerrado", () => {
  it.each([
    ["sin pid", "eightfold-sin-pid.html", /pid/],
    ["sin título", "eightfold-sin-titulo.html", /título/],
  ])("%s", (_name, file, reason) => {
    const res = parse(file);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(reason);
  });

  it("sin HTML", () => {
    expect(eightfoldParser.parse(email(null)).ok).toBe(false);
  });

  it("asunto que no es de un aviso compatible", () => {
    const res = parse("eightfold-match.html", "Your weekly digest");
    expect(res.ok).toBe(false);
  });

  it("sin botón Apply Now", () => {
    const html = fixture("eightfold-match.html").replace(">Apply Now<", ">Ver más<");
    const res = eightfoldParser.parse(email(html));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/postulaci/);
  });

  it("link de postulación que no es de Eightfold", () => {
    const html = fixture("eightfold-match.html").replace(
      "https://empresa-ficticia.eightfold.ai/careers/apply",
      "https://empresa-ficticia.example/careers/apply",
    );
    expect(eightfoldParser.parse(email(html)).ok).toBe(false);
  });

  it("link de postulación con otra ruta", () => {
    const html = fixture("eightfold-match.html").replace("/careers/apply", "/careers/job");
    expect(eightfoldParser.parse(email(html)).ok).toBe(false);
  });

  it("pid que no es numérico", () => {
    const html = fixture("eightfold-match.html").replace("pid=900100200300", "pid=abc");
    expect(eightfoldParser.parse(email(html)).ok).toBe(false);
  });

  it("domain con caracteres raros", () => {
    const html = fixture("eightfold-match.html").replace(
      "domain=empresa-ficticia.example",
      "domain=a%20b%2Fc",
    );
    expect(eightfoldParser.parse(email(html)).ok).toBe(false);
  });

  it("HTML de más de 500 KB", () => {
    const html = fixture("eightfold-match.html") + "<!--" + "x".repeat(500 * 1024) + "-->";
    const res = eightfoldParser.parse(email(html));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/demasiado grande/);
  });

  it("título de más de 200 caracteres", () => {
    const html = fixture("eightfold-match.html").replace(
      "Analista de Datos Semi Senior",
      "T".repeat(201),
    );
    const res = eightfoldParser.parse(email(html));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/título/);
  });

  it("«Matching Specialist» es un título válido; el rótulo «This job is a match» no lo es", () => {
    const html = fixture("eightfold-match.html").replace(
      "Analista de Datos Semi Senior",
      "Matching Specialist",
    );
    const res = eightfoldParser.parse(email(html));
    if (!res.ok) throw new Error(res.reason);
    expect(res.jobs[0]!.title).toBe("Matching Specialist");

    const conRotulo = fixture("eightfold-match.html").replace(
      "</h2>",
      "</h2><h1>This job is a match</h1>",
    );
    const res2 = eightfoldParser.parse(email(conRotulo));
    if (!res2.ok) throw new Error(res2.reason);
    expect(res2.jobs[0]!.title).toBe("Analista de Datos Semi Senior");
  });

  it("skills que parecen prosa (estructura distinta a la esperada)", () => {
    const largo = "x".repeat(200);
    const html = fixture("eightfold-match.html").replace("<li>SQL</li>", `<li>${largo}</li>`);
    expect(eightfoldParser.parse(email(html)).ok).toBe(false);
  });
});

describe("empresa", () => {
  it("sale del parámetro domain y, sin él, del tenant", () => {
    const conDomain = parse("eightfold-match.html");
    if (!conDomain.ok) throw new Error(conDomain.reason);
    expect(conDomain.jobs[0]!.companyRaw).toBe("Empresa Ficticia");

    const html = fixture("eightfold-match.html").replace(
      /&amp;domain=empresa-ficticia\.example/,
      "",
    );
    const sinDomain = eightfoldParser.parse(email(html));
    if (!sinDomain.ok) throw new Error(sinDomain.reason);
    expect(sinDomain.jobs[0]!.companyRaw).toBe("Empresa Ficticia");
    expect(sinDomain.jobs[0]!.source.url).toBe(
      "https://empresa-ficticia.eightfold.ai/careers/apply?pid=900100200300",
    );
  });

  it("companyFromDomain: quita www y sufijos públicos, y capitaliza", () => {
    expect(companyFromDomain("empresa-ficticia.example")).toBe("Empresa Ficticia");
    expect(companyFromDomain("www.empresa-norte.com")).toBe("Empresa Norte");
    expect(companyFromDomain("careers.empresa-sur.com.ar")).toBe("Empresa Sur");
    expect(companyFromDomain("empresa_este.co.uk")).toBe("Empresa Este");
    expect(companyFromDomain("empresa")).toBe("Empresa");
    expect(companyFromDomain("com.ar")).toBeNull();
  });
});
