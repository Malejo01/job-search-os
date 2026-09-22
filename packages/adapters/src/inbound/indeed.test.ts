import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { canonicalUrl } from "@job-search-os/pipeline";
import { describe, expect, it } from "vitest";
import { indeedParser, jobKeyFromTracker } from "./indeed";
import { chooseParserName, EMAIL_PARSERS, type InboundEmailContent } from "./parsers";

/**
 * JS-047 · Parser de Indeed ("empleo compatible", donotreply@match.indeed.com). Un aviso por
 * email; el asunto es "<Título> en <Empresa>". Los links van envueltos en
 * cts.indeed.com/v3/<gzip en base64>: el id del aviso (jk) se saca decodificando el token, sin
 * navegar a ningún lado. Fixtures anonimizadas de los 5 emails reales (2026-09-17..22).
 */
const fixture = (name: string) => readFileSync(resolve(__dirname, "fixtures/indeed", name), "utf8");

const email = (html: string | null, subject: string | null): InboundEmailContent => ({
  from: '"Indeed" <donotreply@match.indeed.com>',
  to: ["u_a0000000@ingest.example.com"],
  subject,
  html,
  text: null,
  receivedAt: new Date("2026-09-22T05:05:29Z"),
});

const parse = (file: string, subject: string) => indeedParser.parse(email(fixture(file), subject));

const token = (url: string) =>
  gzipSync(Buffer.from(JSON.stringify({ u: url }))).toString("base64url");

describe("jobKeyFromTracker", () => {
  it("saca host y jk del token del tracker", () => {
    const href = `https://cts.indeed.com/v3/${token("https://ar.indeed.com/rc/clk?jk=0123456789abcdef&from=x&tk=y")}`;
    expect(jobKeyFromTracker(href)).toEqual({ host: "ar.indeed.com", jk: "0123456789abcdef" });
  });

  it("un token sin aviso (pausar, mala coincidencia) o ilegible no da nada", () => {
    expect(
      jobKeyFromTracker(
        `https://cts.indeed.com/v3/${token("https://match.indeed.com/invitations/pause?tk=z")}`,
      ),
    ).toBeNull();
    expect(jobKeyFromTracker("https://cts.indeed.com/v3/no-es-gzip")).toBeNull();
    expect(jobKeyFromTracker("https://ejemplo.com/otra")).toBeNull();
  });

  it("un link directo al aviso también sirve", () => {
    expect(jobKeyFromTracker("https://ar.indeed.com/viewjob?jk=a1b2c3d4e5f60718")).toEqual({
      host: "ar.indeed.com",
      jk: "a1b2c3d4e5f60718",
    });
  });
});

describe("indeedParser", () => {
  it("empleo con tipo de contrato: título, empresa, ubicación, contrato y URL del aviso", () => {
    const res = parse("indeed-tiempo-completo.html", "Analista de Datos en Empresa Ficticia");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.jobs).toHaveLength(1);
    expect(res.jobs[0]).toMatchObject({
      source: {
        kind: "email_generic",
        name: "Indeed (email)",
        externalId: "0123456789abcdef",
        url: "https://ar.indeed.com/viewjob?jk=0123456789abcdef",
        rawRef: null,
      },
      title: "Analista de Datos",
      companyRaw: "Empresa Ficticia",
      locationRaw: "Capital Federal, Buenos Aires",
      modality: "desconocida",
      contractType: "Tiempo completo",
      countriesAllowed: null,
      jdText: null,
      salaryMinUsd: null,
      salaryNote: null,
    });
  });

  it("«Desde casa» es remoto; el sueldo sin moneda va como nota, no como USD", () => {
    const res = parse(
      "indeed-remoto-con-sueldo.html",
      "Soporte Técnico – Guardias Remotas en Empresa Norte IT",
    );
    if (!res.ok) throw new Error(res.reason);
    expect(res.jobs[0]).toMatchObject({
      title: "Soporte Técnico – Guardias Remotas",
      companyRaw: "Empresa Norte IT",
      locationRaw: "Desde casa",
      modality: "remoto",
      salaryMinUsd: null,
      salaryMaxUsd: null,
      salaryPeriod: null,
      salaryNote: "Sueldo según Indeed: $1.045,00 - $3.232,58 por mes (moneda no indicada)",
      source: { externalId: "fedcba9876543210" },
    });
  });

  it("sin tipo de empleo: contrato null", () => {
    const res = parse("indeed-sin-tipo.html", "Data Engineer con Azure en Empresa Sur Ltd");
    if (!res.ok) throw new Error(res.reason);
    expect(res.jobs[0]).toMatchObject({
      contractType: null,
      locationRaw: "Buenos Aires, Buenos Aires",
    });
  });

  it("varios tipos de empleo y empresa con guion", () => {
    const res = parse(
      "indeed-dos-tipos.html",
      "Account Manager IT - Salta en Empresa Oeste - Grupo Demo",
    );
    if (!res.ok) throw new Error(res.reason);
    expect(res.jobs[0]).toMatchObject({
      title: "Account Manager IT - Salta",
      companyRaw: "Empresa Oeste - Grupo Demo",
      contractType: "Tiempo completo, Por contrato",
    });
  });

  it("la URL es la canónica de Indeed: cruza con una carga manual del mismo aviso", () => {
    const res = parse("indeed-tiempo-completo.html", "Analista de Datos en Empresa Ficticia");
    if (!res.ok) throw new Error(res.reason);
    expect(canonicalUrl(res.jobs[0]!.source.url!)).toEqual(
      canonicalUrl("https://ar.indeed.com/viewjob?jk=0123456789abcdef&from=serp&vjs=3"),
    );
  });

  it("no inventa lo que el email no trae: países, JD (la vista previa está recortada), candidatos, fecha", () => {
    const res = parse("indeed-tiempo-completo.html", "Analista de Datos en Empresa Ficticia");
    if (!res.ok) throw new Error(res.reason);
    const job = res.jobs[0]!;
    expect(job.countriesAllowed).toBeNull();
    expect(job.jdText).toBeNull();
    expect(job.candidatesCount).toBeNull();
    expect(job.postedAt).toBeNull();
    expect(job.badges).toEqual([]);
  });

  it("decodifica entidades en título y empresa", () => {
    const html = fixture("indeed-tiempo-completo.html").replace(
      "Empresa Ficticia</p>",
      "Datos &amp; Cía</p>",
    );
    const res = indeedParser.parse(email(html, "Analista de Datos en Datos & Cía"));
    if (!res.ok) throw new Error(res.reason);
    expect(res.jobs[0]!.companyRaw).toBe("Datos & Cía");
  });

  it("acepta el asunto con prefijo de reenvío", () => {
    expect(
      parse("indeed-sin-tipo.html", "Fwd: Data Engineer con Azure en Empresa Sur Ltd").ok,
    ).toBe(true);
  });
});

describe("indeedParser: falla cerrado", () => {
  const html = fixture("indeed-tiempo-completo.html");
  const subject = "Analista de Datos en Empresa Ficticia";
  // El <h2> del aviso (el email real también trae un <h2>Introducción</h2> sin link)
  const H2_AVISO = /<h2[^>]*>\s*<a[\s\S]*?<\/h2>/;

  it("sin HTML", () => {
    expect(indeedParser.parse(email(null, subject))).toEqual({
      ok: false,
      reason: expect.stringContaining("sin HTML"),
    });
  });

  it("el asunto no coincide con «título en empresa»", () => {
    expect(indeedParser.parse(email(html, "Nuevos empleos para vos")).ok).toBe(false);
    expect(indeedParser.parse(email(html, null)).ok).toBe(false);
  });

  it("sin título del aviso", () => {
    const sin = html.replace(H2_AVISO, "");
    expect(indeedParser.parse(email(sin, subject)).ok).toBe(false);
  });

  it("más de un aviso en el mismo email (formato desconocido)", () => {
    const h2 = H2_AVISO.exec(html)![0];
    expect(indeedParser.parse(email(html.replace(h2, h2 + h2), subject)).ok).toBe(false);
  });

  it("sin el id del aviso en el link del título", () => {
    const sinJk = html.replace(
      /(<h2[^>]*>\s*<a[^>]*href=")[^"]+(")/,
      `$1https://cts.indeed.com/v3/${token("https://ar.indeed.com/")}$2`,
    );
    expect(indeedParser.parse(email(sinJk, subject))).toEqual({
      ok: false,
      reason: expect.stringContaining("id del aviso"),
    });
  });

  it("un email de Indeed que no es un empleo compatible (sin tarjeta)", () => {
    expect(indeedParser.parse(email("<p>Actualizá tu perfil</p>", subject)).ok).toBe(false);
  });
});

describe("despacho", () => {
  it("los emails de Indeed van a este parser", () => {
    expect(chooseParserName('"Indeed" <donotreply@match.indeed.com>')).toBe("indeed");
    expect(EMAIL_PARSERS.indeed).toBe(indeedParser);
  });
});
