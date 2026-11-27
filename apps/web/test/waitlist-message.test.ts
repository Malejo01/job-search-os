import { describe, expect, it } from "vitest";
import { waitlistDoneMessage } from "../lib/waitlist-message";

const BASE = "Listo, te anotamos. Mensaje de siempre.";
const NAMES: Record<string, string> = {
  abogacia: "Abogacía",
  finanzas_contabilidad: "Contaduría",
};
const labelOf = (key: string) => NAMES[key] ?? key;

describe("waitlistDoneMessage (R32-03)", () => {
  it("carrera abierta: el mensaje de siempre", () => {
    expect(waitlistDoneMessage("abogacia", ["abogacia"], BASE, labelOf)).toBe(BASE);
  });

  it("carrera cerrada: dice que todavía suman ofertas y que avisan por email", () => {
    expect(waitlistDoneMessage("abogacia", ["fullstack"], BASE, labelOf)).toBe(
      "Listo, te anotamos. Todavía estamos sumando ofertas de Abogacía. Te avisamos por email apenas abra.",
    );
  });

  it("con la lista vacía, toda carrera espera", () => {
    expect(waitlistDoneMessage("finanzas_contabilidad", [], BASE, labelOf)).toContain(
      "ofertas de Contaduría",
    );
  });

  it("sin dato de la lista (null) no asume nada: el mensaje de siempre", () => {
    expect(waitlistDoneMessage("abogacia", null, BASE, labelOf)).toBe(BASE);
  });

  it("una clave inventada o «otra» no nombra una carrera: el mensaje de siempre", () => {
    expect(waitlistDoneMessage("no_existe", [], BASE, labelOf)).toBe(BASE);
    expect(waitlistDoneMessage("otra", [], BASE, labelOf)).toBe(BASE);
  });

  it("el nombre sale del catálogo, no del pedido: nada que venga de afuera entra al texto", () => {
    expect(waitlistDoneMessage("<b>x</b>", [], BASE, labelOf)).toBe(BASE);
  });
});
