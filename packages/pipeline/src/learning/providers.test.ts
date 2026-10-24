import { describe, expect, it } from "vitest";
import { LEARNING_PROVIDERS, checkModeForUrl, providerForUrl } from "./providers";

describe("LEARNING_PROVIDERS (121 §1, E1b)", () => {
  it("claves únicas y hosts en minúsculas, sin esquema ni barra", () => {
    const keys = LEARNING_PROVIDERS.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const p of LEARNING_PROVIDERS) {
      expect(p.hosts.length).toBeGreaterThan(0);
      for (const h of p.hosts) expect(h).toMatch(/^[a-z0-9.-]+\.[a-z]{2,}$/);
    }
  });

  it("nadie tiene términos leídos todavía: todo queda «a verificar»", () => {
    expect(LEARNING_PROVIDERS.every((p) => p.termsReviewedAt === null)).toBe(true);
  });

  it("los pagos nunca se chequean solos", () => {
    for (const p of LEARNING_PROVIDERS.filter((x) => x.access === "paid")) {
      expect(p.proposedCheckMode).toBe("manual");
    }
  });
});

describe("providerForUrl", () => {
  it("por host exacto o subdominio", () => {
    expect(providerForUrl("https://learn.microsoft.com/es-es/training/")?.key).toBe(
      "microsoft_learn",
    );
    expect(providerForUrl("https://www.freecodecamp.org/espanol/")?.key).toBe("freecodecamp");
  });

  it("un host que solo termina igual no cuenta, y lo desconocido o ilegible es null", () => {
    expect(providerForUrl("https://evilfreecodecamp.org/")).toBeNull();
    expect(providerForUrl("https://example.com/curso")).toBeNull();
    expect(providerForUrl("no es url")).toBeNull();
  });
});

describe("checkModeForUrl: falla cerrado", () => {
  it("sin términos leídos, manual aunque el proveedor proponga auto", () => {
    expect(checkModeForUrl("https://developer.mozilla.org/es/docs/Web")).toBe("manual");
  });

  it("con términos leídos, el modo propuesto", () => {
    const reviewed = LEARNING_PROVIDERS.map((p) =>
      p.key === "mdn" ? { ...p, termsReviewedAt: "2026-11-01" } : p,
    );
    expect(checkModeForUrl("https://developer.mozilla.org/es/docs/Web", reviewed)).toBe("auto");
  });

  it("un host desconocido es manual", () => {
    expect(checkModeForUrl("https://example.com/curso")).toBe("manual");
  });

  it("una fecha mal anotada no cuenta como términos leídos", () => {
    const bad = LEARNING_PROVIDERS.map((p) =>
      p.key === "mdn" ? { ...p, termsReviewedAt: "x" } : p,
    );
    expect(checkModeForUrl("https://developer.mozilla.org/es/docs/Web", bad)).toBe("manual");
  });

  it("solo los gratis sin cuenta pueden ir en auto, aunque alguien proponga otra cosa", () => {
    const risky = LEARNING_PROVIDERS.map((p) =>
      p.key === "coursera"
        ? { ...p, termsReviewedAt: "2026-11-01", proposedCheckMode: "auto" as const }
        : p,
    );
    expect(checkModeForUrl("https://www.coursera.org/learn/x", risky)).toBe("manual");
  });
});
