import { describe, expect, it } from "vitest";
import {
  attributionFor,
  findAtsLinks,
  SOURCE_ATTRIBUTION,
  WWR_PAYWALL_NOTICE,
} from "./attribution";

describe("findAtsLinks", () => {
  it("reconoce cada proveedor", () => {
    const text = [
      "https://boards.greenhouse.io/empresa-a/jobs/1",
      "https://job-boards.greenhouse.io/empresa-a/jobs/2",
      "https://empresa-a.greenhouse.io/x/jobs/3",
    ].join(" ");
    expect(findAtsLinks(text).map((l) => l.provider)).toEqual([
      "greenhouse",
      "greenhouse",
      "greenhouse",
    ]);
    expect(findAtsLinks("ver https://jobs.lever.co/empresa-a/123")).toEqual([
      { provider: "lever", url: "https://jobs.lever.co/empresa-a/123" },
    ]);
    expect(findAtsLinks("https://jobs.ashbyhq.com/empresa-a/abc")[0]?.provider).toBe("ashby");
    expect(findAtsLinks("https://apply.workable.com/empresa-a/j/ABC/")[0]?.provider).toBe(
      "workable",
    );
    expect(findAtsLinks("https://empresa-a.workable.com/j/ABC")[0]?.provider).toBe("workable");
  });

  it("descarta hosts parecidos, credenciales, http y javascript", () => {
    const bad = [
      "https://greenhouse.io.evil.com/x/jobs/1",
      "https://boards.greenhouse.io.evil.com/x",
      "https://evil.com/jobs.lever.co/x",
      "https://jobs.lever.co.evil.com/x",
      "https://notjobs.lever.co/x",
      `https://persona${"@"}jobs.lever.co/x`,
      `https://persona:clave${"@"}jobs.lever.co/x`,
      "https://empresa-a.greenhouse.io/about",
      "https://empresa-a.workable.com/about",
      "http://jobs.lever.co/x/1",
      "javascript:alert(1)//jobs.lever.co",
    ].join(" ");
    expect(findAtsLinks(bad)).toEqual([]);
  });

  it("devuelve la URL sin query ni hash", () => {
    const long = `https://jobs.lever.co/empresa-a/1?x=${"a".repeat(500)}`;
    expect(findAtsLinks(long)[0]?.url).toBe("https://jobs.lever.co/empresa-a/1");
    expect(findAtsLinks("https://jobs.lever.co/empresa-a/1#frag")[0]?.url).toBe(
      "https://jobs.lever.co/empresa-a/1",
    );
  });

  it("descarta URLs de más de 200 caracteres", () => {
    expect(findAtsLinks(`https://jobs.lever.co/${"a".repeat(300)}`)).toEqual([]);
  });

  it("rechaza la barra invertida que engaña al host", () => {
    expect(findAtsLinks(String.raw`https://evil.com\@jobs.lever.co/x`)).toEqual([]);
  });

  it("un token enorme no cuelga el análisis", () => {
    const t0 = performance.now();
    findAtsLinks(`https://${".".repeat(50_000)}a`);
    expect(performance.now() - t0).toBeLessThan(200);
  });

  it("recorta la puntuación final", () => {
    expect(findAtsLinks("(https://jobs.lever.co/empresa-a/1).")[0]?.url).toBe(
      "https://jobs.lever.co/empresa-a/1",
    );
    expect(findAtsLinks("a https://jobs.lever.co/empresa-a/2, b")[0]?.url).toBe(
      "https://jobs.lever.co/empresa-a/2",
    );
  });

  it("sin duplicados, en orden y como máximo 3", () => {
    const text = [1, 1, 2, 3, 4].map((n) => `https://jobs.lever.co/empresa-a/${n}`).join("\n");
    expect(findAtsLinks(text).map((l) => l.url.slice(-1))).toEqual(["1", "2", "3"]);
  });

  it("texto null o vacío", () => {
    expect(findAtsLinks(null)).toEqual([]);
    expect(findAtsLinks("")).toEqual([]);
  });

  it("el aviso del muro de pago existe", () => {
    expect(WWR_PAYWALL_NOTICE).toContain("We Work Remotely");
  });
});

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
