import { describe, expect, it } from "vitest";
import {
  dayKeyIn,
  debeSaludar,
  esDiaValido,
  FESTEJOS,
  FESTEJO_TEXTOS,
  festejoClave,
  festejoCorresponde,
} from "../lib/momentos";

describe("dayKeyIn", () => {
  it("da el día en la zona de la persona, no en UTC", () => {
    // 02:30 UTC del 5 es todavía el 4 en Buenos Aires (UTC-3)
    const d = new Date("2026-03-05T02:30:00Z");
    expect(dayKeyIn(d, "America/Argentina/Buenos_Aires")).toBe("2026-03-04");
    expect(dayKeyIn(d, "UTC")).toBe("2026-03-05");
  });

  it("con una zona inválida cae a UTC en vez de romper", () => {
    expect(dayKeyIn(new Date("2026-03-05T12:00:00Z"), "No/Existe")).toBe("2026-03-05");
  });
});

describe("esDiaValido", () => {
  it("acepta AAAA-MM-DD y nada más", () => {
    expect(esDiaValido("2026-03-05")).toBe(true);
    expect(esDiaValido("2026-3-5")).toBe(false);
    expect(esDiaValido("hoy")).toBe(false);
    expect(esDiaValido(null)).toBe(false);
    expect(esDiaValido("2026-03-05 y algo más")).toBe(false);
  });

  it("R28-10: rechaza fechas que no existen o fuera de rango", () => {
    expect(esDiaValido("2026-99-99")).toBe(false);
    expect(esDiaValido("2026-02-31")).toBe(false);
    expect(esDiaValido("0000-00-00")).toBe(false);
    expect(esDiaValido("9999-12-31")).toBe(false);
    expect(esDiaValido("2028-02-29")).toBe(true);
    expect(esDiaValido("2026-02-29")).toBe(false);
  });
});

describe("debeSaludar (una vez por día)", () => {
  const hoy = "2026-03-05";
  it("saluda la primera vez", () => {
    expect(debeSaludar(null, null, hoy)).toBe(true);
  });
  it("no repite si la cuenta ya anotó hoy (otro dispositivo)", () => {
    expect(debeSaludar(hoy, null, hoy)).toBe(false);
  });
  it("no repite si este navegador ya anotó hoy (cuenta sin leer o sin guardar)", () => {
    expect(debeSaludar(null, hoy, hoy)).toBe(false);
  });
  it("vuelve a saludar al día siguiente", () => {
    expect(debeSaludar("2026-03-04", "2026-03-04", hoy)).toBe(true);
  });
});

describe("festejoCorresponde (una vez por evento)", () => {
  it("festeja cuando el logro pasa de no a sí con la pantalla abierta", () => {
    expect(festejoCorresponde(false, true)).toBe(true);
  });
  it("no festeja si ya estaba cumplido al entrar o al recargar", () => {
    expect(festejoCorresponde(null, true)).toBe(false);
  });
  it("no festeja si sigue sin cumplirse, ni repite si sigue cumplido", () => {
    expect(festejoCorresponde(false, false)).toBe(false);
    expect(festejoCorresponde(true, true)).toBe(false);
  });
  it("no festeja al deshacer el logro", () => {
    expect(festejoCorresponde(true, false)).toBe(false);
  });
});

describe("festejos", () => {
  it("cada festejo tiene sus textos y su clave propia", () => {
    const claves = new Set(FESTEJOS.map(festejoClave));
    expect(claves.size).toBe(FESTEJOS.length);
    for (const f of FESTEJOS) {
      expect(FESTEJO_TEXTOS[f].titulo.length).toBeGreaterThan(0);
      expect(FESTEJO_TEXTOS[f].detalle.length).toBeGreaterThan(0);
    }
  });
});
