import { describe, expect, it } from "vitest";
import { matchesRoleTitle, normalizeTitleText } from "../skills/role-hints";
import { BETA_LAUNCH_ROLE_KEYS, ROLE_KEYS, type RoleKey } from "../skills/self-assessment";
import {
  ALERT_KEYWORDS,
  ALERT_PORTALS,
  alertKeywordsFor,
  AUTOMATIC_PORTAL_IDS,
  COMPUTRABAJO_RECOMMENDED,
  GUIDE_PORTALS,
  isAutomaticPortal,
  isRecommendedPortal,
  portalListText,
  portalOfDomain,
  portalGroupsForRoles,
  portalOfSender,
  portalsForRoles,
  portalStatus,
  searchUrlFor,
} from "./portal-guide";

const NOW = new Date("2026-10-21T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

describe("ALERT_KEYWORDS", () => {
  it("toda carrera de ROLE_KEYS tiene palabras (3 a 6 por idioma)", () => {
    for (const role of ROLE_KEYS) {
      const entry = ALERT_KEYWORDS[role];
      expect(entry, role).toBeDefined();
      for (const lang of ["es", "en"] as const) {
        expect(entry![lang].length, `${role}/${lang}`).toBeGreaterThanOrEqual(3);
        expect(entry![lang].length, `${role}/${lang}`).toBeLessThanOrEqual(6);
      }
    }
  });

  describe("carreras de la beta (C1-5)", () => {
    const BETA: RoleKey[] = [
      "finanzas_contabilidad",
      "abogacia",
      "administracion_empresas",
      "comunicacion",
      "marketing_digital",
      "relaciones_publicas",
      "relaciones_internacionales",
    ];

    it.each(BETA)("%s: cada palabra es un título que la carrera reconoce", (role) => {
      for (const lang of ["es", "en"] as const) {
        for (const word of ALERT_KEYWORDS[role]![lang]) {
          expect(matchesRoleTitle(normalizeTitleText(word), role), `${role}/${lang}: ${word}`).toBe(
            true,
          );
        }
      }
    });

    it.each(BETA)("%s: sin palabras repetidas ni vacías", (role) => {
      for (const lang of ["es", "en"] as const) {
        const words = ALERT_KEYWORDS[role]![lang];
        expect(new Set(words).size).toBe(words.length);
        for (const w of words) expect(w.trim()).not.toBe("");
      }
    });

    it("alertKeywordsFor junta las de varias carreras sin repetir", () => {
      const out = alertKeywordsFor(["abogacia", "relaciones_internacionales"], "both");
      expect(out).toContain("abogado");
      expect(out).toContain("legal counsel");
      expect(out).toContain("comercio exterior");
      expect(new Set(out).size).toBe(out.length);
    });
  });

  it("cubre también data_engineer y solutions_engineer", () => {
    expect(ALERT_KEYWORDS.data_engineer).toBeDefined();
    expect(ALERT_KEYWORDS.solutions_engineer).toBeDefined();
  });

  it("C-2b: finanzas y asistencia/operaciones traen palabras propias en los dos idiomas", () => {
    expect(alertKeywordsFor(["finanzas_contabilidad"], "es")).toContain("contador");
    expect(alertKeywordsFor(["finanzas_contabilidad"], "en")).toContain("accountant");
    expect(alertKeywordsFor(["asistencia_operaciones"], "es")).toContain("asistente virtual");
    expect(alertKeywordsFor(["asistencia_operaciones"], "en")).toContain("virtual assistant");
  });
});

describe("alertKeywordsFor", () => {
  it("AI Engineer en español", () => {
    expect(alertKeywordsFor(["ai_engineer"], "es")).toEqual(
      expect.arrayContaining(["inteligencia artificial", "python", "chatbot"]),
    );
  });

  it("en inglés no trae las de español", () => {
    const words = alertKeywordsFor(["ai_engineer"], "en");
    expect(words).not.toContain("inteligencia artificial");
    expect(words.length).toBeGreaterThan(0);
  });

  it("both junta los dos idiomas sin repetir", () => {
    const words = alertKeywordsFor(["ai_engineer"], "both");
    expect(words).toContain("inteligencia artificial");
    expect(new Set(words).size).toBe(words.length);
    expect(words.length).toBeGreaterThan(alertKeywordsFor(["ai_engineer"], "es").length);
  });

  it("junta varias carreras sin repetir", () => {
    const words = alertKeywordsFor(["backend", "fullstack"], "en");
    expect(new Set(words).size).toBe(words.length);
    expect(words.length).toBeGreaterThan(alertKeywordsFor(["backend"], "en").length - 1);
  });

  it("una carrera desconocida usa su rótulo", () => {
    expect(alertKeywordsFor(["carrera_nueva"], "es")).toEqual(["carrera nueva"]);
  });

  it("sin carreras no devuelve palabras (no se ofrece tecnología sin que la elija)", () => {
    expect(alertKeywordsFor([], "es")).toEqual([]);
    expect(alertKeywordsFor([], "both")).toEqual([]);
  });
});

describe("searchUrlFor", () => {
  it("LinkedIn lleva keywords codificadas", () => {
    const url = searchUrlFor("linkedin", ["inteligencia artificial", "python"]);
    expect(url).not.toBeNull();
    const u = new URL(url!);
    expect(u.origin + u.pathname).toBe("https://www.linkedin.com/jobs/search/");
    expect(u.searchParams.get("keywords")).toBe('"inteligencia artificial" OR python');
  });

  it("sin palabras no hay link", () => {
    expect(searchUrlFor("linkedin", [])).toBeNull();
  });

  it("Indeed y Get on Board no tienen URL estable", () => {
    expect(searchUrlFor("indeed", ["python"])).toBeNull();
    expect(searchUrlFor("getonboard", ["python"])).toBeNull();
  });
});

describe("portalStatus", () => {
  it("nunca si no hubo mails", () => {
    expect(portalStatus(null, NOW)).toBe("nunca");
  });
  it("activo a los 14 días o menos", () => {
    expect(portalStatus(daysAgo(3), NOW)).toBe("activo");
    expect(portalStatus(daysAgo(14), NOW)).toBe("activo");
  });
  it("sin novedad pasados los 14 días", () => {
    expect(portalStatus(daysAgo(15), NOW)).toBe("sin_novedad");
  });
});

describe("portalOfSender", () => {
  it("reconoce los remitentes de empleo de LinkedIn", () => {
    expect(portalOfSender("LinkedIn <jobalerts-noreply@linkedin.com>")).toBe("linkedin");
    expect(portalOfSender("jobs-noreply@linkedin.com")).toBe("linkedin");
  });
  it("los sociales de LinkedIn no cuentan", () => {
    expect(portalOfSender("invitations@linkedin.com")).toBeNull();
    expect(portalOfSender("messages-noreply@linkedin.com")).toBeNull();
  });
  it("Get on Board e Indeed por dominio", () => {
    expect(portalOfSender("Avisos <alertas@mail.getonbrd.com>")).toBe("getonboard");
    expect(portalOfSender("x@getonboard.com")).toBe("getonboard");
    expect(portalOfSender("Indeed <alert@alert.indeed.com>")).toBe("indeed");
  });
  it("otro remitente es null", () => {
    expect(portalOfSender("Banco <aviso@banco.example>")).toBeNull();
    expect(portalOfSender("sin arroba")).toBeNull();
  });
});

describe("ALERT_PORTALS", () => {
  it("son los que tienen lector activo: LinkedIn, Indeed y Get on Board", () => {
    expect(ALERT_PORTALS.map((p) => p.id).sort()).toEqual(["getonboard", "indeed", "linkedin"]);
    for (const p of ALERT_PORTALS) expect(p.howTo.length).toBeGreaterThan(10);
  });
});

describe("GUIDE_PORTALS (R11-5)", () => {
  it("la guía cubre los seis portales, cada uno con su cómo-se-crea", () => {
    expect(GUIDE_PORTALS.map((p) => p.id).sort()).toEqual([
      "bumeran",
      "computrabajo",
      "getonboard",
      "indeed",
      "linkedin",
      "zonajobs",
    ]);
    for (const p of GUIDE_PORTALS) {
      expect(p.howTo.length, p.id).toBeGreaterThan(10);
      expect(p.domains.length, p.id).toBeGreaterThan(0);
    }
  });

  it("«automático» sale de la lista de lectores activos, no de otra cosa", () => {
    expect(isAutomaticPortal("linkedin")).toBe(true);
    expect(isAutomaticPortal("indeed")).toBe(true);
    expect(isAutomaticPortal("getonboard")).toBe(true);
    // Sin lector en main (R11-3 y R11-4 todavía no están): se pega el aviso
    expect(isAutomaticPortal("bumeran")).toBe(false);
    expect(isAutomaticPortal("zonajobs")).toBe(false);
    expect(isAutomaticPortal("computrabajo")).toBe(false);
    expect(ALERT_PORTALS.map((p) => p.id)).toEqual(
      GUIDE_PORTALS.filter((p) => AUTOMATIC_PORTAL_IDS.includes(p.id)).map((p) => p.id),
    );
  });

  it("Computrabajo no se recomienda hasta que haya lector y un aviso real (R11-10)", () => {
    expect(COMPUTRABAJO_RECOMMENDED).toBe(false);
    expect(isRecommendedPortal("computrabajo")).toBe(false);
    expect(isRecommendedPortal("bumeran")).toBe(true);
    expect(isRecommendedPortal("zonajobs")).toBe(true);
    for (const roles of [[], ["fullstack"], ["abogacia"], [...BETA_LAUNCH_ROLE_KEYS]]) {
      expect(portalsForRoles(roles).map((p) => p.id)).not.toContain("computrabajo");
    }
  });
});

describe("portalsForRoles", () => {
  const ids = (roles: string[]) => portalsForRoles(roles).map((p) => p.id);

  it("Get on Board es de tecnología: solo para quien eligió una carrera técnica", () => {
    expect(ids(["fullstack"])).toContain("getonboard");
    expect(ids(["abogacia"])).not.toContain("getonboard");
    expect(ids(["finanzas_contabilidad", "comunicacion"])).not.toContain("getonboard");
    expect(ids(["abogacia", "fullstack"])).toContain("getonboard");
  });

  it("las carreras no técnicas siguen con LinkedIn, Indeed, Bumeran y ZonaJobs", () => {
    expect(ids(["abogacia"])).toEqual(["linkedin", "indeed", "bumeran", "zonajobs"]);
  });

  it("sin carrera elegida se listan todos los recomendados", () => {
    expect(ids([])).toEqual(["linkedin", "indeed", "getonboard", "bumeran", "zonajobs"]);
  });
});

describe("portalGroupsForRoles", () => {
  const names = (list: { name: string }[]) => list.map((p) => p.name);

  it("separa lo que leemos solo de lo que se pega, sin perder ni repetir ninguno", () => {
    const g = portalGroupsForRoles(["abogacia"]);
    expect(names(g.automatic)).toEqual(["LinkedIn", "Indeed"]);
    expect(names(g.manual)).toEqual(["Bumeran", "ZonaJobs"]);
    expect([...g.automatic, ...g.manual].map((p) => p.id).sort()).toEqual(
      portalsForRoles(["abogacia"])
        .map((p) => p.id)
        .sort(),
    );
  });

  it("para tecnología suma Get on Board a lo automático", () => {
    expect(names(portalGroupsForRoles(["fullstack"]).automatic)).toEqual([
      "LinkedIn",
      "Indeed",
      "Get on Board",
    ]);
  });

  it("nunca incluye Computrabajo mientras no se recomiende", () => {
    for (const roles of [[], ["fullstack"], ["abogacia"]]) {
      const g = portalGroupsForRoles(roles);
      expect([...g.automatic, ...g.manual].map((p) => p.id)).not.toContain("computrabajo");
    }
  });
});

describe("portalListText", () => {
  it("une los nombres con coma y «e» o «y» según la palabra", () => {
    const by = (...ids: string[]) => GUIDE_PORTALS.filter((p) => ids.includes(p.id));
    expect(portalListText(by("linkedin"))).toBe("LinkedIn");
    expect(portalListText(by("linkedin", "bumeran"))).toBe("LinkedIn y Bumeran");
    expect(portalListText(by("linkedin", "getonboard", "indeed"))).toBe(
      "LinkedIn, Indeed y Get on Board",
    );
    expect(portalListText(by("linkedin", "indeed", "bumeran"))).toBe("LinkedIn, Indeed y Bumeran");
    expect(portalListText([])).toBe("");
  });
});

describe("portalOfDomain", () => {
  it("reconoce Bumeran, ZonaJobs y Computrabajo por dominio, aunque todavía no tengan lector", () => {
    expect(portalOfDomain("mail.bumeran.com")).toBe("bumeran");
    expect(portalOfDomain("bumeran.com.ar")).toBe("bumeran");
    expect(portalOfDomain("zonajobs.com.ar")).toBe("zonajobs");
    expect(portalOfDomain("computrabajo.com")).toBe("computrabajo");
    expect(portalOfDomain("mail.computrabajo.com.ar")).toBe("computrabajo");
  });

  it("un dominio que solo termina parecido, o ajeno, no es un portal", () => {
    expect(portalOfDomain("notbumeran.com")).toBeNull();
    expect(portalOfDomain("banco.example")).toBeNull();
    expect(portalOfDomain("")).toBeNull();
  });
});

describe("las 8 carreras de la beta", () => {
  it.each([...BETA_LAUNCH_ROLE_KEYS])("%s tiene palabras sugeridas en español", (role) => {
    expect(alertKeywordsFor([role], "es").length).toBeGreaterThanOrEqual(3);
  });
});
