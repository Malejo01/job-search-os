import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  MIN_JOB_TEXT_CHARS,
  hasEnoughJobText,
  jobCardHash,
  normalizeForMatch,
  normalizeJobText,
  sha256Hex,
} from "./normalize";

const nodeSha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

describe("sha256Hex (puro, sin node:crypto)", () => {
  it("coincide con node:crypto en vectores conocidos y de borde", () => {
    const casos = [
      "",
      "abc",
      "a".repeat(55),
      "a".repeat(56),
      "a".repeat(63),
      "a".repeat(64),
      "a".repeat(65),
      "a".repeat(1000),
      "Desarrollador/a Backend — remoto desde Argentina, jornada completa",
      "Ñandú ✓ 日本語 😀",
    ];
    for (const c of casos) expect(sha256Hex(c)).toBe(nodeSha(c));
  });
});

describe("normalizeJobText", () => {
  it("recorta, colapsa espacios y pasa a minúsculas", () => {
    expect(normalizeJobText("  Hola\n\n  MUNDO\t! ")).toBe("hola mundo !");
  });

  it("no toca los acentos (la clave es la misma que jobs.jd_hash)", () => {
    expect(normalizeJobText("Contratación Ñ")).toBe("contratación ñ");
  });
});

describe("jobCardHash", () => {
  it("es el mismo sha256 que jdHash de adapters: normalizado, sin mayúsculas ni espacios repetidos", () => {
    const a = "Buscamos   Analista\n\nde Datos ";
    const b = "buscamos analista de datos";
    expect(jobCardHash(a)).toBe(jobCardHash(b));
    expect(jobCardHash(a)).toBe(nodeSha(b));
    expect(jobCardHash(a)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("un texto distinto da otro hash (si el aviso cambia, hay ficha nueva)", () => {
    expect(jobCardHash("Se pide 3 años")).not.toBe(jobCardHash("Se pide 5 años"));
  });
});

describe("normalizeForMatch", () => {
  it("quita acentos, unifica comillas y guiones, colapsa espacios", () => {
    expect(normalizeForMatch("  Inglés   “avanzado” – C1  ")).toBe('ingles "avanzado" - c1');
    expect(normalizeForMatch("Años de experiencia")).toBe("anos de experiencia");
    expect(normalizeForMatch("it’s")).toBe("it's");
  });

  it("quita viñetas y adornos de lista que el modelo suele omitir", () => {
    expect(normalizeForMatch("• Python\n• SQL")).toBe("python sql");
    expect(normalizeForMatch("- Python\n* SQL")).toBe("python sql");
  });
});

describe("hasEnoughJobText", () => {
  it("falla con texto vacío o muy corto", () => {
    expect(hasEnoughJobText("")).toBe(false);
    expect(hasEnoughJobText("Buscamos gente")).toBe(false);
    expect(hasEnoughJobText(null)).toBe(false);
  });

  it("no cuenta los espacios repetidos como contenido", () => {
    expect(hasEnoughJobText(" ".repeat(MIN_JOB_TEXT_CHARS * 2))).toBe(false);
  });

  it("acepta un aviso con contenido", () => {
    expect(hasEnoughJobText("palabra ".repeat(MIN_JOB_TEXT_CHARS))).toBe(true);
  });
});
