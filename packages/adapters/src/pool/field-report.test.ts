import { describe, expect, it } from "vitest";
import type { RawJob } from "@job-search-os/pipeline";
import {
  countriesLine,
  fieldPresence,
  formatFieldReport,
  languageLine,
  parsePoolCliArgs,
} from "./field-report";

const ES =
  "Buscamos un desarrollador para el equipo de producto. Vas a trabajar con los datos de la empresa y con una API en el stack de Node, con deploy en remote. Es un puesto en la oficina del centro y en las tardes.";
const EN =
  "We are looking for an engineer to join our team. You will work with the product group and have a say in the roadmap. Your work is key to this company and the people we serve.";
const PT =
  "Estamos com uma vaga aberta para o nosso time. Você vai trabalhar com uma equipe de produto, e não precisa ser sênior. Nossa empresa tem um ambiente flexível, com benefícios e mais autonomia, ou seja, pelo seu trabalho.";

function job(over: Partial<RawJob> = {}): RawJob {
  return {
    source: { kind: "remoteok", name: "Fuente A", externalId: null, url: null, rawRef: null },
    title: "Puesto A",
    companyRaw: "Empresa A",
    locationRaw: null,
    countriesAllowed: null,
    modality: "remoto",
    contractType: null,
    salaryMinUsd: null,
    salaryMaxUsd: null,
    salaryPeriod: null,
    salaryNote: null,
    weeklyHours: null,
    candidatesCount: null,
    badges: [],
    jdText: null,
    postedAt: null,
    tags: [],
    seniority: null,
    lang: null,
    ...over,
  };
}

describe("languageLine y countriesLine", () => {
  it("cuenta idiomas, con 'sin idioma' para lo que no se detecta", () => {
    const jobs = [
      job({ jdText: ES }),
      job({ jdText: EN }),
      job({ jdText: EN }),
      job({ jdText: PT }),
      job({ jdText: "React y Node" }),
      job({ jdText: null }),
    ];
    expect(languageLine(jobs)).toBe("por idioma: es=1, en=2, pt=1, sin idioma=2");
  });

  it("cuenta países: abiertos, LatAm, España y otros", () => {
    const jobs = [
      job({ countriesAllowed: null }),
      job({ countriesAllowed: [] }),
      job({ countriesAllowed: ["*"] }),
      job({ countriesAllowed: ["AR", "UY"] }),
      job({ countriesAllowed: ["LATINOAMÉRICA"] }),
      job({ countriesAllowed: ["ES"] }),
      job({ countriesAllowed: ["MX", "ES"] }),
      job({ countriesAllowed: ["US"] }),
      job({ countriesAllowed: ["DE", "FR"] }),
    ];
    expect(countriesLine(jobs)).toBe(
      "por países permitidos: abiertos (sin restricción)=3, incluye LatAm=3, incluye España=2, otros=2",
    );
  });
});

describe("parsePoolCliArgs", () => {
  it("fuentes sin token: wwr y las anteriores", () => {
    for (const s of ["wwr", "getonboard", "remoteok", "jobicy", "himalayas"]) {
      expect(parsePoolCliArgs([s, "--dry-run"])).toEqual({ ok: true, source: s });
    }
  });

  it("ATS con token, región y nombre de empresa", () => {
    expect(
      parsePoolCliArgs([
        "lever",
        "empresa-ficticia",
        "--region",
        "eu",
        "--company",
        "Empresa Ficticia 1",
        "--dry-run",
      ]),
    ).toEqual({
      ok: true,
      source: "lever",
      token: "empresa-ficticia",
      region: "eu",
      company: "Empresa Ficticia 1",
    });
    expect(
      parsePoolCliArgs(["--dry-run", "ashby", "empresa-ficticia", "--company=Empresa Ficticia 2"]),
    ).toMatchObject({
      ok: true,
      source: "ashby",
      region: null,
      company: "Empresa Ficticia 2",
    });
  });

  it("sin --company se usa el token", () => {
    expect(parsePoolCliArgs(["greenhouse", "empresa-ficticia", "--dry-run"])).toMatchObject({
      company: "empresa-ficticia",
    });
  });

  it("rechaza lo inválido sin llegar a hacer requests", () => {
    const bad = [
      [],
      ["linkedin", "--dry-run"],
      ["wwr"],
      ["greenhouse", "--dry-run"],
      ["greenhouse", "../x", "--dry-run"],
      ["greenhouse", "a", "b", "--dry-run"],
      ["greenhouse", "x", "--region", "eu", "--dry-run"],
      ["lever", "x", "--region", "us", "--dry-run"],
      ["lever", "x", "--region", "--dry-run"],
      ["lever", "x", "--company", "--dry-run"],
      ["wwr", "token", "--dry-run"],
      ["wwr", "--region", "eu", "--dry-run"],
      ["wwr", "--otra", "--dry-run"],
    ];
    for (const argv of bad) expect(parsePoolCliArgs(argv).ok, argv.join(" ")).toBe(false);
  });
});

describe("fieldPresence", () => {
  const items = [
    { a: "x", b: 1, c: [1], d: { k: 1 }, e: true },
    { a: "", b: null, c: [], d: undefined, e: false },
    { a: "y", b: "2" },
    "no es objeto",
    null,
    [1, 2],
  ];

  it("cuenta presencia ignorando null, undefined y cadena vacía", () => {
    const rows = fieldPresence(items, ["a", "b"]);
    expect(rows[0]).toEqual({ field: "a", present: 2, types: { string: 2 } });
    expect(rows[1]).toEqual({ field: "b", present: 2, types: { number: 1, string: 1 } });
  });

  it("distingue array, object y boolean; un array vacío o false cuentan como presentes", () => {
    const rows = fieldPresence(items, ["c", "d", "e"]);
    expect(rows[0]).toEqual({ field: "c", present: 2, types: { array: 2 } });
    expect(rows[1]).toEqual({ field: "d", present: 1, types: { object: 1 } });
    expect(rows[2]).toEqual({ field: "e", present: 2, types: { boolean: 2 } });
  });

  it("campo ausente en todos → 0; lista vacía de items → 0", () => {
    expect(fieldPresence(items, ["zzz"])).toEqual([{ field: "zzz", present: 0, types: {} }]);
    expect(fieldPresence([], ["a"])).toEqual([{ field: "a", present: 0, types: {} }]);
  });
});

describe("formatFieldReport", () => {
  it("muestra conteo, porcentaje y tipos, sin valores", () => {
    const items = [{ titulo: "Texto Secreto 1" }, { titulo: "Texto Secreto 2" }, {}, {}];
    const text = formatFieldReport(fieldPresence(items, ["titulo", "otro"]), items.length);
    expect(text).toContain("titulo  2/4 (50%)  string=2");
    expect(text).toContain("otro    0/4 (0%)");
    expect(text).not.toContain("Secreto");
  });

  it("total 0 no divide por cero; sin filas devuelve un aviso", () => {
    expect(formatFieldReport([{ field: "a", present: 0, types: {} }], 0)).toContain("0/0 (0%)");
    expect(formatFieldReport([], 0)).toBe("(sin campos)");
  });
});
