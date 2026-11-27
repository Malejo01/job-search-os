import { describe, expect, it } from "vitest";
import { BRAND } from "../brand";
import { BETA_LAUNCH_ROLE_KEYS } from "../skills/self-assessment";
import {
  alertCountsByPortal,
  alertGuideForCareer,
  alertGuideForRoles,
  PORTAL_ALERT_STEPS,
} from "./alert-steps";
import { fewOffersNotice } from "./few-offers";
import { GUIDE_PORTALS, isAutomaticPortal, portalsForRoles } from "./portal-guide";
import type { PortalStatsRow } from "./portal-stats";

describe("PORTAL_ALERT_STEPS", () => {
  it("cada portal de la guía tiene entre 3 y 6 pasos y una forma de recibirlas", () => {
    for (const portal of GUIDE_PORTALS) {
      const entry = PORTAL_ALERT_STEPS[portal.id];
      expect(entry, portal.id).toBeDefined();
      expect(entry.steps.length, portal.id).toBeGreaterThanOrEqual(3);
      expect(entry.steps.length, portal.id).toBeLessThanOrEqual(6);
      expect(["directa", "reenviar", "pegar"]).toContain(entry.delivery);
    }
  });

  it("los portales que leemos solos se reenvían o se suscriben directo; los que no, se pega el aviso", () => {
    for (const portal of GUIDE_PORTALS) {
      const { delivery } = PORTAL_ALERT_STEPS[portal.id];
      if (portal.id === "computrabajo") expect(delivery).toBe("directa");
      else if (isAutomaticPortal(portal.id)) expect(delivery, portal.id).toBe("reenviar");
      else expect(delivery, portal.id).toBe("pegar");
    }
  });

  it("nombra la dirección de la app solo donde se pega o se reenvía, y nunca promete que la app cree la alerta", () => {
    for (const portal of GUIDE_PORTALS) {
      const text = PORTAL_ALERT_STEPS[portal.id].steps.join(" ");
      expect(text, portal.id).not.toMatch(/\bcreamos\b|\bcrea la alerta por vos\b/i);
    }
    const directa = PORTAL_ALERT_STEPS.computrabajo.steps.join(" ");
    expect(directa).toContain(`dirección de ${BRAND.name}`);
    for (const id of ["linkedin", "indeed", "bumeran", "getonboard"] as const) {
      expect(PORTAL_ALERT_STEPS[id].steps.join(" "), id).toContain(`tu dirección de ${BRAND.name}`);
    }
  });
});

describe("alertGuideForCareer", () => {
  it("una carrera de la beta trae sus palabras en español y sus portales con pasos", () => {
    const guide = alertGuideForCareer("abogacia", "es");
    expect(guide.career).toBe("abogacia");
    expect(guide.keywords).toContain("abogado");
    expect(guide.keywords).not.toContain("legal counsel");
    expect(guide.portals.length).toBeGreaterThan(0);
    for (const p of guide.portals) {
      expect(p.steps.length).toBeGreaterThanOrEqual(3);
      expect(p.automatic).toBe(isAutomaticPortal(p.portal.id));
    }
  });

  it("con «ambos idiomas» suma las palabras en inglés sin repetir", () => {
    const es = alertGuideForCareer("comunicacion", "es").keywords;
    const both = alertGuideForCareer("comunicacion", "both").keywords;
    expect(both.length).toBeGreaterThan(es.length);
    expect(new Set(both).size).toBe(both.length);
  });

  it("Get on Board solo para carreras de tecnología", () => {
    const ids = (career: string) =>
      alertGuideForCareer(career, "es").portals.map((p) => p.portal.id);
    expect(ids("fullstack")).toContain("getonboard");
    expect(ids("abogacia")).not.toContain("getonboard");
    expect(ids("finanzas_contabilidad")).not.toContain("getonboard");
  });

  it("las ocho carreras de la beta tienen guía con palabras", () => {
    for (const career of BETA_LAUNCH_ROLE_KEYS) {
      const guide = alertGuideForCareer(career, "es");
      expect(guide.keywords.length, career).toBeGreaterThanOrEqual(3);
      expect(guide.portals.length, career).toBeGreaterThan(0);
    }
  });

  it("los portales son los mismos que recomienda el resto de la guía (una sola fuente de verdad)", () => {
    for (const career of BETA_LAUNCH_ROLE_KEYS) {
      expect(
        alertGuideForCareer(career, "es").portals.map((p) => p.portal.id),
        career,
      ).toEqual(portalsForRoles([career]).map((p) => p.id));
    }
  });

  it("una clave inventada usa su rótulo y no rompe", () => {
    const guide = alertGuideForCareer("carrera_nueva", "es");
    expect(guide.keywords).toEqual(["carrera nueva"]);
  });
});

describe("alertGuideForRoles", () => {
  it("una guía por carrera, en el orden recibido y sin repetir", () => {
    const guides = alertGuideForRoles(["abogacia", "fullstack", "abogacia"], "es");
    expect(guides.map((g) => g.career)).toEqual(["abogacia", "fullstack"]);
  });
  it("sin carreras no hay guías (la pantalla pide elegir carrera)", () => {
    expect(alertGuideForRoles([], "es")).toEqual([]);
  });
});

const row = (group: string, total: number): PortalStatsRow => ({
  group,
  total,
  highScore: 0,
  applied: 0,
  interview: 0,
  fewData: total < 5,
});

describe("alertCountsByPortal", () => {
  it("cuenta lo que llegó por cada portal de la guía, con el nombre del grupo", () => {
    const counts = alertCountsByPortal([
      row("LinkedIn", 12),
      row("Get on Board", 3),
      row("Bumeran", 7),
      row("Indeed", 2),
      row("Computrabajo", 4),
      row("Remote OK", 40),
      row("Email", 9),
    ]);
    expect(counts).toEqual({
      linkedin: 12,
      getonboard: 3,
      bumeran: 7,
      indeed: 2,
      computrabajo: 4,
    });
  });
  it("lo que no es de un portal de la guía (pool, manual, email sin portal) no se atribuye a ninguno", () => {
    expect(
      alertCountsByPortal([row("Remote OK", 5), row("Cargadas por vos", 3), row("Email", 1)]),
    ).toEqual({});
  });
  it("sin filas, vacío", () => {
    expect(alertCountsByPortal([])).toEqual({});
  });
});

describe("fewOffersNotice", () => {
  const vol = (role: string, total: number, writtenInSpanish: number) => ({
    role,
    label: role.toUpperCase(),
    total,
    writtenInSpanish,
  });

  it("sin carreras con pocas ofertas no hay aviso", () => {
    expect(fewOffersNotice([vol("a", 30, 20)], "es")).toBeNull();
    expect(fewOffersNotice([], "es")).toBeNull();
  });

  it("nombra las carreras con menos de 5 en el idioma de la persona, con cuántas hay", () => {
    const notice = fewOffersNotice([vol("a", 30, 3), vol("b", 30, 20), vol("c", 2, 0)], "es");
    expect(notice).toEqual({
      careers: [
        { role: "a", label: "A", count: 3 },
        { role: "c", label: "C", count: 0 },
      ],
      noun: "español",
      threshold: 5,
    });
  });

  it("en inglés cuenta las que no están en español", () => {
    const notice = fewOffersNotice([vol("a", 6, 4)], "en");
    expect(notice?.careers).toEqual([{ role: "a", label: "A", count: 2 }]);
    expect(notice?.noun).toBe("inglés");
  });

  it("justo en el umbral ya no es «pocas»", () => {
    expect(fewOffersNotice([vol("a", 5, 5)], "es")).toBeNull();
    expect(fewOffersNotice([vol("a", 4, 4)], "es")?.careers).toHaveLength(1);
  });
});
