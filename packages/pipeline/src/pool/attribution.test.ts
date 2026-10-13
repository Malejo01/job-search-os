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
  "wwr",
  "greenhouse",
  "lever",
  "ashby",
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

  it("WWR: Publicado en We Work Remotely", () => {
    expect(attributionFor("wwr")?.text).toBe("Publicado en We Work Remotely");
  });

  it("ATS: nombra la empresa del aviso", () => {
    for (const kind of ["greenhouse", "lever", "ashby"]) {
      expect(attributionFor(kind, { company: "Empresa Ficticia 9" })?.text).toBe(
        "Publicado en el sitio de empleos de Empresa Ficticia 9",
      );
    }
  });

  it("ATS: sin empresa dice 'la empresa'", () => {
    for (const company of [undefined, null, "", "   "]) {
      expect(attributionFor("greenhouse", { company })?.text).toBe(
        "Publicado en el sitio de empleos de la empresa",
      );
    }
    expect(attributionFor("lever")?.text).toBe("Publicado en el sitio de empleos de la empresa");
  });

  it("ATS: el nombre no rompe el reemplazo ni crece sin tope", () => {
    expect(attributionFor("ashby", { company: "A $& B" })?.text).toContain("A $& B");
    expect(attributionFor("ashby", { company: "x".repeat(500) })?.text.length).toBeLessThan(150);
  });

  it("las demás fuentes ignoran la empresa", () => {
    expect(attributionFor("jobicy", { company: "Empresa A" })?.text).toBe("Publicado en Jobicy");
    expect(attributionFor("manual", { company: "Empresa A" })).toBeNull();
  });
});
