import { describe, expect, it } from "vitest";
import { claimAsistenteAviso, ASISTENTE_AVISO_KEY } from "../lib/asistente-aviso";

function fakeStorage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

describe("claimAsistenteAviso", () => {
  it("la primera vez de la sesión se muestra y queda marcado", () => {
    const s = fakeStorage();
    expect(claimAsistenteAviso(s)).toBe(true);
    expect(s.data.get(ASISTENTE_AVISO_KEY)).toBe("1");
  });

  it("la segunda vez no se muestra", () => {
    const s = fakeStorage();
    claimAsistenteAviso(s);
    expect(claimAsistenteAviso(s)).toBe(false);
  });

  it("sin almacenamiento no se muestra", () => {
    expect(claimAsistenteAviso(null)).toBe(false);
  });

  it("si leer falla no se muestra", () => {
    const s = {
      getItem: () => {
        throw new Error("bloqueado");
      },
      setItem: () => undefined,
    };
    expect(claimAsistenteAviso(s)).toBe(false);
  });

  it("si escribir falla no se muestra (volvería a aparecer en cada página)", () => {
    const s = {
      getItem: () => null,
      setItem: () => {
        throw new Error("lleno");
      },
    };
    expect(claimAsistenteAviso(s)).toBe(false);
  });
});
