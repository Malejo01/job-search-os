import { describe, expect, it } from "vitest";
import { SELLOS_TEXTOS, sealAriaLabel, sealSentence, sealWord } from "../lib/textos-rediseno";

describe("sello de afinidad: palabras y frases (R30-02)", () => {
  it("la palabra de cada sello", () => {
    expect(sealWord("alta")).toBe("Afinidad alta");
    expect(sealWord("media")).toBe("Afinidad media");
    expect(sealWord("baja")).toBe("Afinidad baja");
    expect(sealWord("sin_evaluar")).toBe("Sin evaluar");
    expect(sealWord("pendiente")).toBe("Leyendo la oferta contra tu perfil…");
  });

  it("aria-label: «puntaje N» con punto, redondeado a un decimal, y la palabra del nivel", () => {
    expect(sealAriaLabel("alta", 8.5)).toBe("puntaje 8.5, afinidad alta");
    expect(sealAriaLabel("media", 6.9)).toBe("puntaje 6.9, afinidad media");
    expect(sealAriaLabel("baja", 3)).toBe("puntaje 3, afinidad baja");
    // 6,96 se ve «7,0»: el lector oye lo mismo que ve
    expect(sealAriaLabel("alta", 6.96)).toBe("puntaje 7, afinidad alta");
    expect(sealAriaLabel("sin_evaluar", null)).toBe("sin evaluar");
    expect(sealAriaLabel("pendiente", null)).toBe("en cola");
  });

  it("frase para lectores de pantalla: un decimal y coma", () => {
    expect(sealSentence("alta", 10)).toBe("Puntaje 10,0 de 10, afinidad alta");
    expect(sealSentence("media", 5)).toBe("Puntaje 5,0 de 10, afinidad media");
    expect(sealSentence("baja", 2.04)).toBe("Puntaje 2,0 de 10, afinidad baja");
    expect(sealSentence("sin_evaluar", null)).toBe("Sin evaluar");
    expect(sealSentence("pendiente", null)).toBe("En cola para evaluar");
  });

  it("la aclaración fija es la de la regla 5 del plan", () => {
    expect(SELLOS_TEXTOS.aclaracion).toBe(
      "Esta comparación usa la información del aviso y de tu perfil. No indica tus posibilidades de contratación.",
    );
  });
});
