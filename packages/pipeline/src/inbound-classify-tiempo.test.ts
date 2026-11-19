import { describe, expect, it } from "vitest";
import { classifyInbound } from "./inbound-classify";

const MB2 = 2 * 1024 * 1024;
/** Las máquinas del CI son más lentas y compartidas: el margen evita falsos rojos. */
const CI_FACTOR = process.env.CI ? 4 : 1;

function elapsed(fn: () => unknown): number {
  const start = performance.now();
  fn();
  return performance.now() - start;
}

const repeated = (unit: string, size: number) => unit.repeat(Math.floor(size / unit.length));

describe("classifyInbound · entrada hostil de 2 MB", () => {
  const viewed = (text: string, subject = "Empresa A viewed your application") =>
    classifyInbound({ from: "Aviso <x@linkedin.com>", subject, text });

  it("una línea con 2 MB de espacios vuelve en menos de 100 ms", () => {
    const text = `a${" ".repeat(MB2)}b`;
    expect(elapsed(() => viewed(text))).toBeLessThan(100 * CI_FACTOR);
  });

  it("2 MB de una línea con el comienzo del encabezado repetido vuelven en menos de 100 ms", () => {
    const text = repeated("Empresa A viewed ", MB2);
    expect(elapsed(() => viewed(text))).toBeLessThan(100 * CI_FACTOR);
  });

  it("2 MB de espacios en cada variante de postulación vuelven en menos de 100 ms", () => {
    const text = `a${" ".repeat(MB2)}b`;
    for (const subject of [
      "Se ha enviado tu solicitud a Empresa A",
      "Empresa A ha visto tu solicitud",
      "Your application was sent to Empresa A",
    ]) {
      expect(elapsed(() => viewed(text, subject))).toBeLessThan(100 * CI_FACTOR);
    }
  });

  it("un asunto de 2 MB vuelve en menos de 100 ms", () => {
    const subject = `Empresa A${" ".repeat(MB2)}viewed your application`;
    expect(elapsed(() => viewed("hola", subject))).toBeLessThan(100 * CI_FACTOR);
  });

  it("una línea de más de 500 caracteres no cuenta como encabezado", () => {
    const heading = `Empresa A viewed your application ${"x".repeat(600)}`;
    const out = viewed(`${heading}\nDesarrollador Backend`);
    expect(out.application?.title).toBeNull();
  });

  it("el encabezado normal sigue dando el puesto de la línea siguiente", () => {
    const out = viewed("Empresa A viewed your application\n\nDesarrollador Backend\nBuenos Aires");
    expect(out).toMatchObject({
      category: "postulacion_vista",
      application: { company: "Empresa A", title: "Desarrollador Backend" },
    });
  });
});
