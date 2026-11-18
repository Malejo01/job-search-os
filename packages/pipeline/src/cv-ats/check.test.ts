import { describe, expect, it } from "vitest";
import {
  ATS_DISCLAIMER,
  ATS_MAX_INPUT_CHARS,
  ATS_MAX_POINTS,
  ATS_MIN_POINTS,
  ATS_TITLE,
  checkCvAts,
  type AtsReport,
  type AtsSkill,
} from "./check";

/** Todo inventado: personas, empresas y datos de contacto ficticios (dominio de ejemplo y teléfono de relleno). */
const SKILLS: AtsSkill[] = [
  { name: "SQL" },
  { name: "Excel" },
  { name: "Power BI", aliases: ["powerbi"] },
  { name: "Python" },
  { name: "Estadística", aliases: ["estadistica"] },
];

const CONTACT_EMAIL = "candidata.prueba@example.com";
const CONTACT_PHONE = "011 4000 1234";
const CONTACT_PHONE_2 = "011 4567-8901";

const FILLER =
  "Armé reportes semanales para el equipo comercial y automaticé tareas repetitivas con herramientas internas. " +
  "Trabajé con distintas áreas para entender qué necesitaban y presentar los resultados de forma clara.";

/** CV de una sola columna, con títulos, fechas con mes y año, contacto y largo razonable. */
const WELL_BUILT = [
  "Persona Ejemplo",
  `${CONTACT_EMAIL} | ${CONTACT_PHONE}`,
  "",
  "Experiencia laboral",
  "Analista de datos - Empresa A",
  "03/2021 - actual",
  FILLER,
  "Uso SQL y Excel todos los días, y armo tableros en Power BI.",
  "Asistente administrativa - Empresa B",
  "marzo 2018 - febrero 2021",
  FILLER,
  "Registré y conté movimientos en planillas de Excel.",
  "",
  "Educación",
  "Licenciatura en Estadística - Universidad A",
  "2013 - 2018",
  "Curso de Python para análisis de datos - Instituto A",
  "",
  "Habilidades",
  "SQL, Excel, Power BI, Python, comunicación, trabajo en equipo",
  "Inglés intermedio, lectura técnica y conversación básica.",
  FILLER,
].join("\n");

const kinds = (r: AtsReport) => r.points.map((p) => `${p.id}:${p.status}`);
const run = (text: string, skills: readonly AtsSkill[] = SKILLS): AtsReport => {
  const r = checkCvAts(text, skills);
  if (!r.ok) throw new Error(`error inesperado: ${r.error}`);
  return r.value;
};

describe("checkCvAts: CV bien armado", () => {
  it("es «Legible» y devuelve de 3 a 5 puntos", () => {
    const r = run(WELL_BUILT);
    expect(r.verdict).toBe("legible");
    expect(r.label).toBe("Legible");
    expect(r.points.length).toBeGreaterThanOrEqual(ATS_MIN_POINTS);
    expect(r.points.length).toBeLessThanOrEqual(ATS_MAX_POINTS);
    expect(r.points.every((p) => p.status === "ok" && p.how === null)).toBe(true);
  });
});

describe("checkCvAts: CV en dos columnas", () => {
  const twoColumns = WELL_BUILT.split("\n")
    .map((l, i, all) => (l === "" ? l : `${l}      ${all[all.length - 1 - i] ?? ""}`))
    .join("\n")
    .replace("Experiencia laboral", "Experiencia laboral          Habilidades")
    .replace(/^Educación$/m, "Educación          Contacto");

  it("dice que el texto salió desordenado y no es «Legible»", () => {
    const r = run(twoColumns);
    expect(r.verdict).not.toBe("legible");
    const orden = r.points.find((p) => p.id === "orden");
    expect(orden?.status).toBe("bad");
    expect(orden?.what).toMatch(/salió desordenado/);
    expect(orden?.how).toMatch(/una sola columna/);
  });

  it("no afirma que haya columnas: habla del texto, no del archivo", () => {
    const orden = run(twoColumns).points.find((p) => p.id === "orden");
    expect(orden?.what).not.toMatch(/tu CV (tiene|está en) (dos )?columnas/i);
  });
});

describe("checkCvAts: CV sin fechas", () => {
  const noDates = WELL_BUILT.replace(/^.*(\d{2}\/\d{4}|marzo 2018|\d{4} - \d{4}).*$/gm, "");

  it("marca las fechas y no es «Legible»", () => {
    const r = run(noDates);
    expect(r.verdict).toBe("legible_con_arreglos");
    expect(kinds(r)).toContain("fechas:bad");
    expect(r.points.find((p) => p.id === "fechas")?.how).toMatch(/03\/2021/);
  });

  it("con solo años pide el mes, pero no lo da por perdido", () => {
    const onlyYears = noDates + "\nTrabajé en Empresa A entre 2019 y 2022 y en Empresa B en 2016.";
    expect(kinds(run(onlyYears))).toContain("fechas:fix");
  });
});

describe("checkCvAts: CV escaneado (texto vacío)", () => {
  it.each(["", "   \n \n ", "pág. 1"])("«%s» es «Difícil de leer» y lo dice primero", (text) => {
    const r = run(text);
    expect(r.verdict).toBe("dificil");
    expect(r.label).toBe("Difícil de leer");
    expect(r.points[0]).toMatchObject({ id: "texto", status: "bad" });
    expect(r.points[0]?.what).toMatch(/imagen o un escaneo/);
    expect(r.points).toHaveLength(3);
    // sin texto no se inventan otros problemas
    expect(r.points.map((p) => p.id)).not.toContain("fechas");
  });
});

describe("checkCvAts: fechas y teléfono sin falsos positivos (R14-2)", () => {
  /** Sin ninguna fecha ni teléfono: cada test suma solo lo que prueba. */
  const BASE = [
    "Persona Ejemplo",
    CONTACT_EMAIL,
    "Experiencia laboral",
    FILLER,
    FILLER,
    "Educación",
    FILLER,
    "Habilidades",
    "SQL, Excel, Python",
    FILLER,
  ].join("\n");
  const problems = (text: string) =>
    run(text, [])
      .points.filter((p) => p.status !== "ok")
      .map((p) => p.id);

  it("«Marketing 2021» y «Junior 2020» no son fechas con mes", () => {
    expect(problems(`${BASE}\nMarketing 2021 y Junior 2020`)).toContain("fechas");
    expect(problems(`${BASE}\nMayorista 2019 y Marzo 2020x`)).toContain("fechas");
  });

  it.each(["marzo 2021 y sept. 2021", "mar 2021 y sept 2022", "Septiembre de 2021 y ene 2022"])(
    "«%s» sí son fechas con mes y año",
    (dates) => {
      expect(problems(`${BASE}\n${dates}`)).not.toContain("fechas");
    },
  );

  it("un rango de fechas con puntos no es un teléfono", () => {
    expect(problems(`${BASE}\n01.2020 - 03.2021`)).toContain("contacto");
  });

  it("un teléfono con separadores sí cuenta", () => {
    expect(problems(`${BASE}\n${CONTACT_PHONE_2}\n03/2021 - 08/2023`)).not.toContain("contacto");
  });
});

describe("checkCvAts: otros chequeos", () => {
  it("poco texto o muy corto pide completar", () => {
    const r = run(
      "Persona Ejemplo\nAnalista de datos\nExperiencia\nEmpresa A 03/2021 actual\n".repeat(2),
    );
    expect(kinds(r)).toContain("texto:fix");
    expect(kinds(r)).toContain("largo:fix");
  });

  it("un CV larguísimo se marca por el largo", () => {
    const r = run(
      `${WELL_BUILT}\n${"Detalle de proyecto con varias palabras para sumar largo. ".repeat(260)}`,
    );
    expect(kinds(r)).toContain("largo:fix");
  });

  it("sin email ni teléfono lo avisa, sin copiar nada", () => {
    const text = WELL_BUILT.replace(`${CONTACT_EMAIL} | ${CONTACT_PHONE}`, "Persona Ejemplo");
    const contacto = run(text).points.find((p) => p.id === "contacto");
    expect(contacto?.status).toBe("fix");
    expect(contacto?.what).toMatch(/un email ni un teléfono/);
  });

  it("un rango de años no cuenta como teléfono", () => {
    const text = WELL_BUILT.replace(` | ${CONTACT_PHONE}`, "");
    expect(run(text).points.find((p) => p.id === "contacto")?.what).toMatch(/un teléfono/);
  });

  it("cuenta las skills de la carrera escritas, con alias y sin acentos", () => {
    const sinSkills = WELL_BUILT.replace(/SQL|Excel|Power BI|Python|Estadística/g, "—");
    const bad = run(sinSkills).points.find((p) => p.id === "skills");
    expect(bad?.status).toBe("bad");
    expect(bad?.what).toMatch(/0 de las 5/);
    expect(bad?.what).toMatch(/SQL/);
    const ok = run(WELL_BUILT.replace("Estadística", "estadistica")).points.find(
      (p) => p.id === "skills",
    );
    expect(ok?.status ?? "ok").toBe("ok");
  });

  it("sin skills de carrera no revisa ese punto", () => {
    expect(kinds(run(WELL_BUILT, []))).not.toContain("skills:ok");
    expect(run(WELL_BUILT, []).verdict).toBe("legible");
  });

  it("los puntos van de lo más grave a lo menos grave y nunca pasan de 5", () => {
    const r = run("x ".repeat(50));
    expect(r.points.length).toBeLessThanOrEqual(ATS_MAX_POINTS);
  });
});

describe("checkCvAts: privacidad y texto honesto", () => {
  it("no copia nada del CV al resultado (ni email, ni teléfono, ni nombres)", () => {
    const json = JSON.stringify(run(WELL_BUILT));
    for (const secret of [
      CONTACT_EMAIL,
      "example.com",
      CONTACT_PHONE,
      "4000 1234",
      "Persona Ejemplo",
      "Empresa A",
      "Universidad A",
    ]) {
      expect(json).not.toContain(secret);
    }
  });

  it("el texto nunca promete que «pasa los filtros» ni entrevistas", () => {
    const all = [
      ATS_TITLE,
      ATS_DISCLAIMER,
      ...[WELL_BUILT, "", "x ".repeat(40)].flatMap((t) =>
        run(t).points.flatMap((p) => [p.what, p.how ?? ""]),
      ),
    ].join("\n");
    expect(all).not.toMatch(/pas(a|ar|ás)\s+(los\s+)?filtros|entrevista|garantiz(a|amos)\s+que/i);
    expect(ATS_TITLE).toMatch(/legible por los filtros/);
  });

  it("R14-2: textos largos sin espacios o con muchos espacios se revisan en menos de 1 s", () => {
    const time = (text: string) => {
      const t0 = Date.now();
      expect(checkCvAts(text).ok).toBe(true);
      return Date.now() - t0;
    };
    // un pegado de 200.000 caracteres sin espacios ni arroba (el email probaba desde cada posición)
    expect(time("a".repeat(ATS_MAX_INPUT_CHARS))).toBeLessThan(1000);
    // una línea con 100.000 espacios en el medio (el título de sección recortaba espacios al final)
    expect(time(`${WELL_BUILT}\na${" ".repeat(100_000)}b`)).toBeLessThan(1000);
  });

  it("una entrada enorme se rechaza en vez de colgar el navegador", () => {
    const r = checkCvAts("a".repeat(ATS_MAX_INPUT_CHARS + 1));
    expect(r).toEqual({ ok: false, error: "texto_demasiado_largo" });
  });
});
