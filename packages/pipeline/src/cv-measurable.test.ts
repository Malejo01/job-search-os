import { describe, expect, it } from "vitest";
import {
  CV_MEASURABLE_TARGET_MAX,
  CV_MEASURABLE_TARGET_MIN,
  analyzeCvMeasurable,
  hasMeasurableResult,
} from "./cv-measurable";

describe("hasMeasurableResult: lo que sí es un resultado", () => {
  it.each([
    ["Reduje los errores de carga un 18%", "porcentaje"],
    ["Subí la conversión 12 % en tres meses", "porcentaje con espacio"],
    ["Aumenté las ventas en un 20 por ciento", "por ciento"],
    ["Ahorré EUR 2.500 al año con una macro nueva", "moneda (EUR)"],
    ["Conseguí un presupuesto de $1,5M para el área", "moneda ($ y M)"],
    ["Facturé 800 mil pesos en el primer mes", "moneda (pesos) y mil"],
    ["Reduje el cierre de 5 días a 2 días", "tiempo"],
    ["Acorté el reporte semanal a 30 minutos", "tiempo (minutos)"],
    ["Lideré un equipo de 6 personas", "cantidad de personas"],
    ["Coordiné a cinco desarrolladores en dos países", "personas en palabras"],
    ["Atendí 120 clientes por mes", "cantidad de clientes"],
    ["Gestioné 40 nuevos proveedores", "cantidad con adjetivo"],
    ["Pasé de 40 a 80 tickets resueltos por semana", "de X a Y"],
    ["Bajé la mora de 12 a 7", "de X a Y sin unidad"],
    ["Reduje a la mitad el tiempo de carga de pedidos", "la mitad"],
    ["Dupliqué la cantidad de reportes entregados", "duplicar"],
    ["Mejoré el rendimiento 3x con un índice nuevo", "multiplicador"],
  ])("%s (%s)", (bullet) => {
    expect(hasMeasurableResult(bullet)).toBe(true);
  });
});

describe("hasMeasurableResult: lo que no es un resultado", () => {
  it.each([
    ["Trabajé en el área comercial", "sin números"],
    ["", "vacía"],
    ["   ", "solo espacios"],
    ["En 2021 migré la base de datos", "año suelto"],
    ["Analista de datos (2020 - 2022)", "período con guion"],
    ["Armé tableros de ventas de 2020 a 2022", "período con «de X a Y» de años"],
    ["Trabajé en Empresa A desde marzo de 2021", "mes y año"],
    ["Desarrollé una API con Java 8", "versión"],
    ["Migré el sistema a Python 3.11", "versión con punto"],
    ["Usé la versión 2.1 del sistema", "versión explícita"],
    ["Cursé 3 años de la carrera", "duración en años"],
    ["Contacto: 15/03/2022", "fecha numérica"],
  ])("%s (%s)", (bullet) => {
    expect(hasMeasurableResult(bullet)).toBe(false);
  });

  it("no se deja engañar por mayúsculas ni acentos", () => {
    expect(hasMeasurableResult("REDUJE LOS ERRORES UN 18%")).toBe(true);
    expect(hasMeasurableResult("LIDERÉ UN EQUIPO DE 6 PERSONAS")).toBe(true);
  });
});

describe("analyzeCvMeasurable", () => {
  const withResult = (n: number) =>
    Array.from({ length: n }, (_, i) => `Reduje el tiempo del proceso ${i + 10}%`);
  const without = (n: number) =>
    Array.from({ length: n }, () => "Armé reportes semanales para el equipo de ventas");

  it("sin viñetas puntúa 0 y lo dice", () => {
    const r = analyzeCvMeasurable([]);
    expect(r).toMatchObject({ total: 0, withResult: 0, score: 0, example: null });
  });

  it("las viñetas vacías no cuentan", () => {
    const r = analyzeCvMeasurable(["", "   ", "Reduje errores un 20%"]);
    expect(r.total).toBe(1);
  });

  it("el puntaje es la proporción respecto de la meta, con piso y tope por cantidad", () => {
    // meta = mitad de las viñetas, entre MIN y MAX
    expect(CV_MEASURABLE_TARGET_MIN).toBe(3);
    expect(CV_MEASURABLE_TARGET_MAX).toBe(6);
    // 12 viñetas, 6 con resultado: meta 6 -> 10
    expect(analyzeCvMeasurable([...withResult(6), ...without(6)]).score).toBe(10);
    // 40 viñetas, 6 con resultado: el tope evita pedir más de 6 -> 10
    expect(analyzeCvMeasurable([...withResult(6), ...without(34)]).score).toBe(10);
    // 40 viñetas, 3 con resultado: 3 de 6 -> 5
    expect(analyzeCvMeasurable([...withResult(3), ...without(37)]).score).toBe(5);
    // pocas viñetas: el piso evita el 10 con una sola
    expect(analyzeCvMeasurable([...withResult(1), ...without(1)]).score).toBe(3.3);
    // ninguna con resultado: 0
    expect(analyzeCvMeasurable(without(5)).score).toBe(0);
  });

  it("el consejo cita una viñeta real sin resultado, sin reescribirla", () => {
    const bullet = "Armé reportes semanales para el equipo de ventas";
    const r = analyzeCvMeasurable(["Reduje errores un 20%", bullet, "Armé otra cosa distinta"]);
    expect(r.example).toBe(bullet);
  });

  it("prefiere una viñeta con contenido a un fragmento corto", () => {
    const r = analyzeCvMeasurable(["Ventas", "Coordiné la migración de la planilla de clientes"]);
    expect(r.example).toBe("Coordiné la migración de la planilla de clientes");
  });

  it("recorta una viñeta larguísima al citarla", () => {
    const r = analyzeCvMeasurable(["palabra ".repeat(100).trim()]);
    expect(r.example!.length).toBeLessThanOrEqual(121);
    expect(r.example!.endsWith("…")).toBe(true);
  });

  it("si todas tienen resultado no hay ejemplo", () => {
    expect(analyzeCvMeasurable(withResult(3)).example).toBeNull();
  });

  it("es determinista y no muta la entrada", () => {
    const input = [...withResult(2), ...without(2)];
    const before = JSON.stringify(input);
    expect(analyzeCvMeasurable(input)).toEqual(analyzeCvMeasurable(input));
    expect(JSON.stringify(input)).toBe(before);
  });

  it("con una entrada de 2 MB responde en menos de 100 ms", () => {
    const huge = Array.from({ length: 2_000 }, () => "palabra de relleno ".repeat(55)); // ~2 MB
    analyzeCvMeasurable(huge); // calentamiento
    const t0 = performance.now();
    const r = analyzeCvMeasurable(huge);
    expect(performance.now() - t0).toBeLessThan(100);
    expect(r.total).toBeGreaterThan(0);
  });
});
