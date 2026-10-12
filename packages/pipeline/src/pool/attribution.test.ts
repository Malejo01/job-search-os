import { describe, expect, it } from "vitest";
import { attributionFor, SOURCE_ATTRIBUTION } from "./attribution";

// Valores de `source_kind` en packages/db/schema.ts (pipeline no puede importar db). Si el enum
// cambia, este test y el mapa se actualizan juntos.
const SOURCE_KINDS = [
  "getonboard_api",
  "email_linkedin",
  "email_getonboard",
  "email_generic",
  "manual",
  "hn_whoishiring",
  "remotive",
  "other",
  "remoteok",
  "jobicy",
  "himalayas",
] as const;

describe("SOURCE_ATTRIBUTION", () => {
  it("tiene una entrada por cada fuente", () => {
    expect(Object.keys(SOURCE_ATTRIBUTION).sort()).toEqual([...SOURCE_KINDS].sort());
  });

  it("las fuentes públicas con términos de atribución la llevan", () => {
    expect(SOURCE_ATTRIBUTION.remoteok?.text).toBe("Publicado en Remote OK");
    expect(SOURCE_ATTRIBUTION.jobicy?.text).toBe("Publicado en Jobicy");
    expect(SOURCE_ATTRIBUTION.getonboard_api?.text).toBe("Publicado en Get on Board");
    expect(SOURCE_ATTRIBUTION.himalayas?.text).toBe("Datos de Himalayas");
    expect(SOURCE_ATTRIBUTION.himalayas?.homeUrl).toBe("https://himalayas.app");
  });

  it("las fuentes propias de la persona no llevan atribución", () => {
    for (const kind of ["email_linkedin", "email_getonboard", "email_generic", "manual"] as const) {
      expect(SOURCE_ATTRIBUTION[kind]).toBeNull();
    }
  });

  it("ningún texto trae códigos internos y las homeUrl son https", () => {
    for (const entry of Object.values(SOURCE_ATTRIBUTION)) {
      if (!entry) continue;
      for (const kind of SOURCE_KINDS) {
        expect(entry.text).not.toContain(kind);
        expect(entry.name).not.toContain(kind);
      }
      expect(entry.text).not.toContain("_");
      if (entry.homeUrl) expect(entry.homeUrl).toMatch(/^https:\/\//);
    }
  });
});

describe("attributionFor", () => {
  it("devuelve null para una fuente desconocida o heredada del prototipo", () => {
    expect(attributionFor("inventada")).toBeNull();
    expect(attributionFor("constructor")).toBeNull();
    expect(attributionFor("manual")).toBeNull();
    expect(attributionFor("jobicy")?.name).toBe("Jobicy");
  });
});
