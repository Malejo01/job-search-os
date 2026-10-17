import { describe, expect, it } from "vitest";
import { detectEnglish, ENGLISH_ESTIMATED, MAX_JD_CHARS } from "./english";

const EN_TEXT =
  "We are looking for a developer to join our team. You will work with the product group and have ownership of this area. We value your ideas.";
const ES_TEXT =
  "Buscamos una persona para el equipo de desarrollo. Vas a trabajar con los equipos de producto y tu aporte es parte de la cultura de la empresa.";

describe("detectEnglish · pide inglés y nivel", () => {
  it("'Inglés avanzado (excluyente)'", () => {
    const r = detectEnglish("Requisitos: Inglés avanzado (excluyente).", null);
    expect(r).toMatchObject({ asks: true, level: "avanzado" });
  });

  it("'English B2+'", () => {
    expect(detectEnglish("Requirements: English B2+", null)).toMatchObject({
      asks: true,
      level: "avanzado",
    });
  });

  it("'Fluent English is a must'", () => {
    expect(detectEnglish("Fluent English is a must for this role.", null)).toMatchObject({
      asks: true,
      level: "fluido",
    });
  });

  it("'Nice to have: conversational English'", () => {
    expect(detectEnglish("Nice to have: conversational English", null)).toMatchObject({
      asks: true,
      level: "intermedio",
    });
  });

  it("'Spanish and English (bilingual)'", () => {
    expect(detectEnglish("Languages: Spanish and English (bilingual)", null)).toMatchObject({
      asks: true,
      level: "fluido",
    });
  });

  it("nivel básico", () => {
    expect(detectEnglish("Conocimientos de inglés básico", null)).toMatchObject({
      asks: true,
      level: "basico",
    });
    expect(detectEnglish("English level A2 required", null).level).toBe("basico");
  });

  it("CEFR intermedio B1", () => {
    expect(detectEnglish("Nivel de inglés B1", null).level).toBe("intermedio");
  });

  it("'upper-intermediate' es avanzado, no intermedio", () => {
    expect(detectEnglish("English: upper-intermediate or better", null).level).toBe("avanzado");
  });

  it("'full professional' es fluido", () => {
    expect(detectEnglish("English at full professional proficiency", null).level).toBe("fluido");
  });

  it("pide inglés sin nivel", () => {
    const r = detectEnglish("Se requiere manejo de inglés para leer documentación.", null);
    expect(r).toMatchObject({ asks: true, level: null });
  });

  it("con varias menciones vale el nivel más alto", () => {
    const text =
      "English B1 for the support team.\n\n\n\n\n\n\n\n\n\n\n\nFor leads: fluent English.";
    expect(detectEnglish(text, null).level).toBe("fluido");
  });

  it("acentos y mayúsculas no importan", () => {
    expect(detectEnglish("INGLÉS AVANZADO", null)).toMatchObject({ asks: true, level: "avanzado" });
  });
});

describe("detectEnglish · lo que no es un requisito", () => {
  it("'Spanish-speaking team' sin mención de inglés", () => {
    expect(detectEnglish("Join our Spanish-speaking team in Buenos Aires.", null).asks).toBe(false);
  });

  it("'English version'", () => {
    const r = detectEnglish("Este aviso tiene una English version disponible.", null);
    expect(r.asks).toBe(false);
  });

  it("'in English below'", () => {
    expect(detectEnglish("Aviso en español. Description in English below.", null).asks).toBe(false);
  });

  it("'en inglés abajo'", () => {
    expect(detectEnglish("Descripción del puesto en inglés abajo", null).asks).toBe(false);
  });

  it("'versión en inglés'", () => {
    expect(detectEnglish("Podés ver la versión en inglés de este aviso", null).asks).toBe(false);
  });

  it("'english' sin contexto de requisito", () => {
    const filler = "x ".repeat(80);
    expect(detectEnglish(`Senior English Teacher ${filler}`, null).asks).toBe(false);
  });

  it("aviso en inglés sin mención del idioma", () => {
    const r = detectEnglish(EN_TEXT, null);
    expect(r).toEqual({ language: "en", asks: false, level: null });
  });

  it("aviso en español sin mención del idioma", () => {
    const r = detectEnglish(ES_TEXT, null);
    expect(r).toEqual({ language: "es", asks: false, level: null });
  });

  it("texto null", () => {
    expect(detectEnglish(null, null)).toEqual({ language: null, asks: false, level: null });
  });

  it("texto vacío", () => {
    expect(detectEnglish("", null)).toEqual({ language: null, asks: false, level: null });
  });
});

describe("detectEnglish · idioma del aviso", () => {
  it("la columna lang manda, en cualquier formato", () => {
    expect(detectEnglish(ES_TEXT, "en").language).toBe("en");
    expect(detectEnglish(EN_TEXT, "ES-AR").language).toBe("es");
  });

  it("lang desconocido cae al conteo", () => {
    expect(detectEnglish(EN_TEXT, "pt").language).toBe("en");
  });

  it("pocos aciertos: null", () => {
    expect(detectEnglish("React and Node", null).language).toBeNull();
  });

  it("sin ventaja de 2 a 1: null", () => {
    const mixed = "the and you with will our for are de la el y con para que";
    expect(detectEnglish(mixed, null).language).toBeNull();
  });

  it("un aviso en inglés que pide inglés suma ambos", () => {
    const r = detectEnglish(`${EN_TEXT} Written and spoken English is required.`, null);
    expect(r).toMatchObject({ language: "en", asks: true });
  });
});

describe("detectEnglish · ámbito de oración e ítem", () => {
  it("el nivel de otro ítem no se contagia", () => {
    const text =
      "- Strong written and verbal communication skills in English.\n- Native-level fluency in Dutch";
    expect(detectEnglish(text, null)).toMatchObject({ asks: true, level: null });
  });

  it("el nivel de otra oración no se contagia", () => {
    const text = "Advanced Excel is needed. Good spoken English.";
    expect(detectEnglish(text, null)).toMatchObject({ asks: true, level: null });
  });

  it("'professional' del otro idioma no cuenta", () => {
    const text = "Strong written and spoken English; professional Korean proficiency is preferred";
    expect(detectEnglish(text, null)).toMatchObject({ asks: true, level: null });
  });

  it("nivel más cerca de otro idioma en el mismo fragmento no cuenta", () => {
    const text = "Good English and professional Italian";
    expect(detectEnglish(text, null)).toMatchObject({ asks: true, level: null });
  });

  it("nivel que introduce una lista con english sí cuenta", () => {
    expect(detectEnglish("Fluent in Spanish, Italian and English", null).level).toBe("fluido");
    expect(detectEnglish("Fluency in both English and German", null).level).toBe("fluido");
    expect(detectEnglish("Fluency in English and Korean", null).level).toBe("fluido");
  });

  it("ítem de lista con idioma y nivel", () => {
    expect(detectEnglish("Perfil:\n- Fluent English\n- Git", null)).toMatchObject({
      asks: true,
      level: "fluido",
    });
    expect(detectEnglish("• Inglés intermedio", null).level).toBe("intermedio");
  });
});

describe("detectEnglish · exclusiones y niveles nuevos", () => {
  it.each([
    "We write in plain English for all users.",
    "We write in plain-english for all users.",
    "Free English classes for the team.",
    "Free english lessons are included in your benefits.",
    "Beneficio: clases de inglés para el equipo",
    "Please send your CV in English.",
    "Enviá tu cv en inglés",
    "Attach a resume in English",
  ])("no pide: %s", (text) => {
    expect(detectEnglish(text, null).asks).toBe(false);
  });

  it.each([
    "Company language is English",
    "Our working language is English",
    "Inglés técnico para leer documentación",
    "Capacidad de leer en inglés",
    "Idioma: inglés",
  ])("contexto de requisito: %s", (text) => {
    expect(detectEnglish(text, null).asks).toBe(true);
  });

  it.each([
    ["Professional English", "avanzado"],
    ["Business-level English", "avanzado"],
    ["Business level English", "avanzado"],
    ["English working proficiency", "avanzado"],
    ["Advanced ability in English", "avanzado"],
    ["Inglés nivel avanzado", "avanzado"],
    ["Bilingüe en inglés", "fluido"],
    ["English fluency", "fluido"],
    ["Native English", "fluido"],
    ["Inglés nativo", "fluido"],
  ] as const)("%s → %s", (text, level) => {
    expect(detectEnglish(text, null)).toMatchObject({ asks: true, level });
  });

  it.each([
    "Excellent English",
    "Exceptional written English",
    "Clear spoken English",
    "Good English",
  ])("adjetivo sin nivel: %s", (text) => {
    expect(detectEnglish(text, null)).toMatchObject({ asks: true, level: null });
  });
});

describe("detectEnglish · texto hostil", () => {
  it("20 KB en una sola línea con niveles, idiomas y miles de english termina rápido", () => {
    const unit = "c2 spanish fluent german english b2 italian english ";
    const text = unit.repeat(Math.ceil(20_000 / unit.length));
    const t0 = performance.now();
    const r = detectEnglish(text, null);
    expect(performance.now() - t0).toBeLessThan(200);
    expect(r.asks).toBe(true);
  });

  it("solo 'english' repetido, sin separadores", () => {
    const text = "english ".repeat(2_500);
    const t0 = performance.now();
    detectEnglish(text, null);
    expect(performance.now() - t0).toBeLessThan(200);
  });

  it("100 KB: lo que pasa de MAX_JD_CHARS se ignora", () => {
    expect(MAX_JD_CHARS).toBe(30_000);
    const filler = "x ".repeat(50_000);
    expect(detectEnglish(`${filler}\nFluent English is a must`, null).asks).toBe(false);
    expect(detectEnglish(`Fluent English is a must\n${filler}`, null)).toMatchObject({
      asks: true,
      level: "fluido",
    });
  });

  it("un fragmento largo se parte en trozos de 1 500 caracteres", () => {
    const filler = "x ".repeat(1_000);
    const t0 = performance.now();
    const r = detectEnglish(`${filler} Fluent English ${filler}`, null);
    expect(performance.now() - t0).toBeLessThan(200);
    expect(r.asks).toBe(true);
  });
});

describe("ENGLISH_ESTIMATED", () => {
  it("queda apagado: la precisión medida el 16/10 fue 29 de 30", () => {
    expect(ENGLISH_ESTIMATED).toBe(false);
  });
});
