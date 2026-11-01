import { describe, expect, it } from "vitest";
import {
  CAREER_REVEAL_THRESHOLD,
  CAREER_REVEAL_WINDOW_DAYS,
  buildCareerRevealRows,
} from "./career-reveal";
import { UNLISTED_ROLE_KEYS } from "./skills/self-assessment";

describe("buildCareerRevealRows: cuándo mostrar una carrera nueva (ADR-022, C4-3)", () => {
  it("el umbral es de 10 ofertas en 30 días (ADR-022)", () => {
    expect(CAREER_REVEAL_THRESHOLD).toBe(10);
    expect(CAREER_REVEAL_WINDOW_DAYS).toBe(30);
  });

  it("marca «lista» desde el umbral inclusive y calcula cuántas faltan", () => {
    const rows = buildCareerRevealRows(
      ["abogacia", "comunicacion", "asistencia_operaciones"],
      [
        { role: "abogacia", received: 10, active: 12 },
        { role: "comunicacion", received: 9, active: 9 },
        { role: "asistencia_operaciones", received: 25, active: 30 },
      ],
    );
    const by = Object.fromEntries(rows.map((r) => [r.role, r]));
    expect(by.abogacia).toMatchObject({ ready: true, missing: 0, received: 10 });
    expect(by.comunicacion).toMatchObject({ ready: false, missing: 1, received: 9 });
    expect(by.asistencia_operaciones).toMatchObject({ ready: true, missing: 0 });
  });

  it("una carrera sin ninguna oferta aparece en cero, no desaparece", () => {
    const rows = buildCareerRevealRows(
      ["abogacia", "comunicacion"],
      [{ role: "abogacia", received: 4, active: 4 }],
    );
    expect(rows.find((r) => r.role === "comunicacion")).toEqual({
      role: "comunicacion",
      received: 0,
      active: 0,
      threshold: 10,
      ready: false,
      missing: 10,
    });
  });

  it("ignora claves que no están entre las ocultas y no cuenta dos veces una repetida", () => {
    const rows = buildCareerRevealRows(
      ["abogacia"],
      [
        { role: "frontend", received: 500, active: 500 },
        { role: "abogacia", received: 3, active: 3 },
        { role: "abogacia", received: 4, active: 4 },
      ],
    );
    expect(rows.map((r) => r.role)).toEqual(["abogacia"]);
    // La última fila repetida no suma ni pisa: se queda con el mayor
    expect(rows[0]!.received).toBe(4);
  });

  it("ordena: primero las listas, después por ofertas y por clave", () => {
    const rows = buildCareerRevealRows(
      ["a", "b", "c", "d"],
      [
        { role: "a", received: 3, active: 3 },
        { role: "b", received: 12, active: 12 },
        { role: "c", received: 8, active: 8 },
        { role: "d", received: 12, active: 20 },
      ],
    );
    expect(rows.map((r) => r.role)).toEqual(["b", "d", "c", "a"]);
  });

  it("sanea números raros (negativos, NaN, no enteros) como cero", () => {
    const rows = buildCareerRevealRows(["a"], [{ role: "a", received: Number.NaN, active: -4 }]);
    expect(rows[0]).toMatchObject({ received: 0, active: 0, ready: false });
  });

  it("sirve con las claves ocultas reales", () => {
    const rows = buildCareerRevealRows(UNLISTED_ROLE_KEYS, []);
    expect(rows).toHaveLength(UNLISTED_ROLE_KEYS.length);
    expect(rows.every((r) => !r.ready)).toBe(true);
  });
});
