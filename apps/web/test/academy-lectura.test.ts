import { describe, expect, it } from "vitest";
import {
  ACADEMY_ORIGENES,
  fichaRelacionadas,
  normalizeSearch,
  parseOrigen,
  readingMinutes,
  recomendadasPorOrigen,
  searchFichas,
} from "../lib/academy-lectura";
import { fichaBajada, parseFicha } from "../lib/academy";

const items = [
  {
    slug: "metodo-star",
    titulo: "El método STAR",
    bajada: "Ordená tus respuestas en cuatro pasos.",
  },
  { slug: "filtro-ats", titulo: "¿Qué es un filtro ATS?", bajada: "Un sistema que ordena CVs." },
  { slug: "nivel-de-ingles", titulo: "Nivel de inglés", bajada: "Cómo contarlo con honestidad." },
];

describe("normalizeSearch", () => {
  it("saca acentos y mayúsculas y recorta", () => {
    expect(normalizeSearch("  Inglés ")).toBe("ingles");
    expect(normalizeSearch("MÉTODO")).toBe("metodo");
    expect(normalizeSearch("¿Qué?")).toBe("¿que?");
  });
});

describe("searchFichas", () => {
  it("sin consulta devuelve todo, en el mismo orden", () => {
    expect(searchFichas(items, "").map((i) => i.slug)).toEqual(items.map((i) => i.slug));
    expect(searchFichas(items, "   ")).toHaveLength(3);
  });

  it("ignora acentos y mayúsculas, en título y en bajada", () => {
    expect(searchFichas(items, "INGLES").map((i) => i.slug)).toEqual(["nivel-de-ingles"]);
    expect(searchFichas(items, "metodo").map((i) => i.slug)).toEqual(["metodo-star"]);
    expect(searchFichas(items, "honestidad").map((i) => i.slug)).toEqual(["nivel-de-ingles"]);
  });

  it("todas las palabras tienen que aparecer (en cualquier orden)", () => {
    expect(searchFichas(items, "ordena cvs").map((i) => i.slug)).toEqual(["filtro-ats"]);
    expect(searchFichas(items, "star cvs")).toEqual([]);
  });

  it("sin resultados devuelve una lista vacía", () => {
    expect(searchFichas(items, "zzz")).toEqual([]);
  });
});

describe("readingMinutes", () => {
  it("200 palabras por minuto, redondeado hacia arriba, mínimo 1", () => {
    expect(readingMinutes(0)).toBe(1);
    expect(readingMinutes(120)).toBe(1);
    expect(readingMinutes(200)).toBe(1);
    expect(readingMinutes(201)).toBe(2);
    expect(readingMinutes(Number.NaN)).toBe(1);
  });
});

describe("fichaRelacionadas", () => {
  const todas = [
    "metodo-star",
    "carta-de-presentacion",
    "filtro-ats",
    "palabras-clave",
    "afinidad",
  ];

  it("devuelve solo las disponibles, sin la propia, hasta 3", () => {
    const r = fichaRelacionadas("filtro-ats", todas);
    expect(r).not.toContain("filtro-ats");
    expect(r.length).toBeLessThanOrEqual(3);
    expect(r).toContain("palabras-clave");
    for (const s of r) expect(todas).toContain(s);
  });

  it("si las relacionadas no están publicadas, no inventa otras", () => {
    expect(fichaRelacionadas("filtro-ats", ["filtro-ats"])).toEqual([]);
    expect(fichaRelacionadas("desconocida", todas)).toEqual([]);
  });
});

describe("parseOrigen", () => {
  it("acepta solo la lista cerrada", () => {
    for (const o of ACADEMY_ORIGENES) expect(parseOrigen(o)).toBe(o);
    expect(parseOrigen("interview")).toBe("interview");
  });

  it("rechaza lo demás: vacío, desconocido, arreglos, mayúsculas, trucos", () => {
    expect(parseOrigen(undefined)).toBeNull();
    expect(parseOrigen("")).toBeNull();
    expect(parseOrigen("Interview")).toBeNull();
    expect(parseOrigen("https://example.com")).toBeNull();
    expect(parseOrigen("__proto__")).toBeNull();
    expect(parseOrigen("constructor")).toBeNull();
    expect(parseOrigen(["interview", "cv"])).toBeNull();
  });
});

describe("recomendadasPorOrigen", () => {
  it("desde Interview, la ficha STAR si está publicada", () => {
    expect(recomendadasPorOrigen("interview", ["metodo-star", "afinidad"])).toEqual([
      "metodo-star",
    ]);
  });

  it("sin la ficha publicada o sin origen, nada", () => {
    expect(recomendadasPorOrigen("interview", ["afinidad"])).toEqual([]);
    expect(recomendadasPorOrigen(null, ["metodo-star"])).toEqual([]);
  });

  it("no recomienda la ficha que se está leyendo", () => {
    expect(recomendadasPorOrigen("interview", ["metodo-star"], "metodo-star")).toEqual([]);
  });
});

describe("fichaBajada", () => {
  it("toma el primer párrafo y lo corta en una palabra entera", () => {
    const f = parseFicha("x", "---\ntitulo: X\n---\nPrimer párrafo corto.\n\nSegundo párrafo.")!;
    expect(fichaBajada(f)).toBe("Primer párrafo corto.");
    const larga = parseFicha("y", `---\ntitulo: Y\n---\n${"palabra ".repeat(60)}`)!;
    const b = fichaBajada(larga);
    expect(b.length).toBeLessThanOrEqual(141);
    expect(b.endsWith("…")).toBe(true);
    expect(b).not.toMatch(/palabr…$/);
  });

  it("sin párrafo, cadena vacía", () => {
    expect(fichaBajada(parseFicha("z", "---\ntitulo: Z\n---\n- solo lista")!)).toBe("");
  });
});
