import { describe, expect, it } from "vitest";
import { MASCOTA_NOMBRE } from "../lib/mascota";
import { AFI_DICE, llenarTexto } from "../lib/textos-rediseno";

// El componente `<AfiDice>` (TSX) no se renderiza en vitest (sin plugin de JSX): lo cubren los e2e 290 a 293.

describe("llenarTexto (R28-15)", () => {
  it("completa {nombre} y {n} y deja lo que no conoce", () => {
    expect(llenarTexto("¡Hola, {nombre}! {n} ofertas {otro}", { nombre: "Ana", n: 3 })).toBe(
      "¡Hola, Ana! 3 ofertas {otro}",
    );
  });
  it("inserta el valor como texto, sin interpretar nada", () => {
    expect(llenarTexto("{nombre}", { nombre: "<b>x</b>" })).toBe("<b>x</b>");
  });
});

describe("textos de Afi (R28-15)", () => {
  const todos: string[] = [];
  const recorrer = (v: unknown) => {
    if (typeof v === "string") todos.push(v);
    else if (v && typeof v === "object") Object.values(v).forEach(recorrer);
  };
  recorrer(AFI_DICE);

  it("son cortos y sin placeholders desconocidos", () => {
    expect(todos.length).toBeGreaterThan(10);
    for (const t of todos) {
      expect(t.length).toBeLessThanOrEqual(130);
      for (const m of t.matchAll(/\{(\w+)\}/g)) expect(["nombre", "n"]).toContain(m[1]);
    }
  });
  it("el nombre de la mascota sale de la constante", () => {
    expect(AFI_DICE.interview.texto).toContain(`Soy ${MASCOTA_NOMBRE} y te voy a entrevistar`);
  });
});
