import { describe, expect, it } from "vitest";
import {
  CALIBRATION_CSV_HEADER,
  CALIBRATION_MAX,
  CALIBRATION_MIN,
  calibrationCsv,
  calibrationSummary,
  isCalibrationPrompt,
  maskPersonalData,
  selectCalibrationSet,
  type CalibrationItem,
  type CalibrationMark,
} from "./kit";

const BOM = String.fromCharCode(0xfeff);

const DISCIPLINES = [
  "abogacia",
  "finanzas_contabilidad",
  "negocio",
  "comunicacion",
  "marketing_digital",
  "relaciones_publicas",
  "relaciones_internacionales",
  "backend",
];

/** 8 carreras × 6 ofertas: la mitad con condición excluyente, idiomas y modalidades mezclados. */
function pool(perDiscipline = 6): CalibrationItem[] {
  const out: CalibrationItem[] = [];
  const langs = ["es", "es", "en", "pt", "es", "en"] as const;
  const mods = ["presencial", "hibrido", "remoto"] as const;
  DISCIPLINES.forEach((d, di) => {
    for (let i = 0; i < perDiscipline; i++) {
      out.push({
        id: `job-${String(di).padStart(2, "0")}-${i}`,
        discipline: d,
        modality: mods[i % 3]!,
        language: langs[i % 6]!,
        hasBlocking: i % 2 === 1,
        score: 4 + ((di + i) % 6),
      });
    }
  });
  return out;
}

describe("isCalibrationPrompt: solo la evaluación nueva", () => {
  it("evaluate_job desde v1.5", () => {
    expect(isCalibrationPrompt("evaluate_job@v1.5.0")).toBe(true);
    expect(isCalibrationPrompt("evaluate_job@v1.10.0")).toBe(true);
    expect(isCalibrationPrompt("evaluate_job@v2")).toBe(true);
  });
  it("no las anteriores ni otras tareas", () => {
    for (const p of [
      "evaluate_job@v1.4.0",
      "evaluate_job@v1.3.4",
      "evaluate_job@v1",
      "cv_review@v1.5.0",
      "",
    ]) {
      expect(isCalibrationPrompt(p), p).toBe(false);
    }
  });
});

describe("selectCalibrationSet: entre 20 y 30 ofertas variadas", () => {
  it("devuelve el objetivo pedido dentro de 20 a 30 (y 24 por defecto)", () => {
    expect(selectCalibrationSet(pool())).toHaveLength(24);
    expect(selectCalibrationSet(pool(), 5)).toHaveLength(CALIBRATION_MIN);
    expect(selectCalibrationSet(pool(), 99)).toHaveLength(CALIBRATION_MAX);
    expect(selectCalibrationSet(pool(), 27)).toHaveLength(27);
  });

  it("cada carrera aparece (al menos 2 de 24 con 8 carreras) y ninguna se come el cupo", () => {
    const set = selectCalibrationSet(pool());
    for (const d of DISCIPLINES) {
      const n = set.filter((i) => i.discipline === d).length;
      expect(n, d).toBeGreaterThanOrEqual(2);
      expect(n, d).toBeLessThanOrEqual(4);
    }
  });

  it("mezcla con y sin condición excluyente, idiomas y modalidades", () => {
    const set = selectCalibrationSet(pool());
    expect(set.some((i) => i.hasBlocking)).toBe(true);
    expect(set.some((i) => !i.hasBlocking)).toBe(true);
    expect(new Set(set.map((i) => i.language)).size).toBeGreaterThanOrEqual(3);
    expect(new Set(set.map((i) => i.modality)).size).toBe(3);
    // y en cada carrera con 3 o más lugares, las dos clases de condición
    for (const d of DISCIPLINES) {
      const mine = set.filter((i) => i.discipline === d);
      if (mine.length >= 3) {
        expect(
          mine.some((i) => i.hasBlocking),
          d,
        ).toBe(true);
        expect(
          mine.some((i) => !i.hasBlocking),
          d,
        ).toBe(true);
      }
    }
  });

  it("es estable: el mismo conjunto siempre, sin importar el orden de entrada", () => {
    const a = selectCalibrationSet(pool());
    const b = selectCalibrationSet(pool().reverse());
    expect(b.map((i) => i.id)).toEqual(a.map((i) => i.id));
  });

  it("no repite ofertas", () => {
    const ids = selectCalibrationSet(pool()).map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("con pocas ofertas devuelve las que hay; sin ofertas, vacío", () => {
    expect(selectCalibrationSet(pool(1))).toHaveLength(8);
    expect(selectCalibrationSet([])).toEqual([]);
  });

  it("con una sola carrera igual completa el cupo", () => {
    const only = pool(30).filter((i) => i.discipline === "abogacia");
    expect(selectCalibrationSet(only)).toHaveLength(24);
  });

  it("no cambia lo que recibe", () => {
    const input = pool();
    const copia = JSON.stringify(input);
    selectCalibrationSet(input);
    expect(JSON.stringify(input)).toBe(copia);
  });
});

const mark = (over: Partial<CalibrationMark> = {}): CalibrationMark => ({
  person: "a1b2c3",
  jobRef: "9f8e7d6c",
  promptVersion: "evaluate_job@v1.5.0",
  discipline: "abogacia",
  modality: "presencial",
  english: "no",
  hadFullJd: true,
  score: 7.5,
  accion: "aplicar",
  blockers: 1,
  verdict: "de_acuerdo",
  note: null,
  humanScore: null,
  markedAt: "2026-11-26",
  title: null,
  company: null,
  ...over,
});

describe("calibrationSummary", () => {
  it("cuenta marcadas, de acuerdo y en desacuerdo, y la proporción sobre lo marcado", () => {
    const s = calibrationSummary([
      mark(),
      mark({ verdict: "en_desacuerdo", note: "Leyó mal la modalidad" }),
      mark({ verdict: "de_acuerdo", discipline: "backend" }),
      mark({ verdict: null, discipline: "backend" }),
    ]);
    expect(s).toMatchObject({ total: 4, marked: 3, agree: 2, disagree: 1 });
    expect(s.agreementRate).toBeCloseTo(2 / 3);
    expect(s.byDiscipline.abogacia).toEqual({ marked: 2, agree: 1, disagree: 1 });
    expect(s.byDiscipline.backend).toEqual({ marked: 1, agree: 1, disagree: 0 });
  });

  it("sin marcas no inventa una proporción", () => {
    const s = calibrationSummary([mark({ verdict: null })]);
    expect(s).toMatchObject({ total: 1, marked: 0, agreementRate: null, scoreDiff: null });
    expect(calibrationSummary([]).total).toBe(0);
  });

  it("diferencia media entre el puntaje propuesto y el de la evaluación, solo donde hay propuesta", () => {
    const s = calibrationSummary([
      mark({ score: 7, humanScore: 5 }),
      mark({ score: 6, humanScore: 7 }),
      mark({ score: 9, humanScore: null }),
    ]);
    expect(s.scoreDiff).toEqual({ n: 2, mean: -0.5 });
  });

  it("solo cuenta la evaluación nueva (una marca sobre una versión vieja no mezcla)", () => {
    const s = calibrationSummary([mark(), mark({ promptVersion: "evaluate_job@v1.4.0" })]);
    expect(s.total).toBe(1);
  });
});

describe("calibrationCsv: la exportación del admin, sin datos personales", () => {
  it("encabezado fijo, una fila por oferta y BOM para planillas", () => {
    const csv = calibrationCsv([mark(), mark({ verdict: "en_desacuerdo" })]);
    const rows = csv.replace(BOM, "").trimEnd().split("\r\n");
    expect(rows[0]).toBe(CALIBRATION_CSV_HEADER);
    expect(rows).toHaveLength(3);
    expect(csv.startsWith(BOM)).toBe(true);
  });

  it("el encabezado no tiene ninguna columna de contacto o identidad", () => {
    expect(CALIBRATION_CSV_HEADER).not.toMatch(
      /email|mail|nombre|name|user_id|usuario|telefono|cv|perfil/i,
    );
  });

  it("neutraliza fórmulas de planilla y comillas en el motivo", () => {
    const csv = calibrationCsv([mark({ note: '=SUMA("a")' })]);
    expect(csv).toContain(`"'=SUMA(""a"")"`);
  });

  it("enmascara emails, teléfonos y URLs del motivo", () => {
    const note =
      "escribime a x@example.com o al +00 11 2222-3333, mirá https://ejemplo.example/perfil/x y www.ejemplo.example";
    const csv = calibrationCsv([mark({ note })]);
    expect(csv).toContain("escribime a [email] o al [teléfono], mirá [enlace] y [enlace]");
    for (const dato of ["x@example.com", "2222-3333", "ejemplo.example"]) {
      expect(csv).not.toContain(dato);
    }
  });

  it("maskPersonalData deja intacto el texto sin datos y no confunde números cortos", () => {
    expect(maskPersonalData("Leyó mal la modalidad")).toBe("Leyó mal la modalidad");
    expect(maskPersonalData("Puntaje 7,5 de 10, pide 3 años")).toBe(
      "Puntaje 7,5 de 10, pide 3 años",
    );
    expect(maskPersonalData("uno@example.com y dos@example.org")).toBe("[email] y [email]");
    expect(maskPersonalData("00 1111 2222")).toBe("[teléfono]");
  });

  it("el título y la empresa solo salen si vienen (avisos del pool); una oferta propia sale vacía", () => {
    const con = calibrationCsv([mark({ title: "Abogado/a", company: "Empresa A" })]);
    const sin = calibrationCsv([mark()]);
    expect(con).toContain('"Abogado/a","Empresa A"');
    expect(sin).not.toContain("Empresa A");
  });

  it("solo exporta la evaluación nueva", () => {
    const csv = calibrationCsv([mark(), mark({ promptVersion: "evaluate_job@v1.3.4" })]);
    expect(csv.trimEnd().split("\r\n")).toHaveLength(2);
  });

  it("sin filas, solo el encabezado", () => {
    expect(calibrationCsv([]).replace(BOM, "").trimEnd()).toBe(CALIBRATION_CSV_HEADER);
  });
});
