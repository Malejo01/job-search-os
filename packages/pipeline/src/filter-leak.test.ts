import { describe, expect, it } from "vitest";
import {
  baseDomain,
  detectFilterLeaks,
  EXPECTED_SOURCE_DOMAINS,
  senderCategory,
  type SenderHost,
} from "./filter-leak";

/**
 * JS-048 · Posible fuga del filtro de reenvío. Nació del 2026-09-18..21: el filtro de Gmail mal
 * escrito reenvió banco, streaming, cursos y GitHub (27 de 55 emails) y el aviso de volumen no
 * saltó porque llegaban pocos por día. La señal es quién manda, no cuánto llega.
 */
const NOW = new Date("2026-09-21T12:00:00Z");
const h = (hoursAgo: number) => new Date(NOW.getTime() - hoursAgo * 3_600_000);

const host = (over: Partial<SenderHost> & { host: string }): SenderHost => ({
  firstAt: h(1),
  lastAt: h(1),
  recent: 1,
  ...over,
});

describe("baseDomain", () => {
  it.each([
    ["mails.bancoejemplo.com.ar", "bancoejemplo.com.ar"],
    ["comunicaciones.bancoejemplo.com.ar", "bancoejemplo.com.ar"],
    ["join.netflix.com", "netflix.com"],
    ["match.indeed.com", "indeed.com"],
    ["avenga.teamtailor-mail.com", "teamtailor-mail.com"],
    ["getonbrd.com", "getonbrd.com"],
    ["mail.ejemplo.co.uk", "ejemplo.co.uk"],
    ["noticias.ejemplo.com.br", "ejemplo.com.br"],
    ["LinkedIn.COM", "linkedin.com"],
  ])("%s → %s", (input, out) => {
    expect(baseDomain(input)).toBe(out);
  });
});

describe("senderCategory (orientativa, por lista explícita)", () => {
  it("reconoce bancos, streaming y e-commerce por el dominio", () => {
    expect(senderCategory("bancoejemplo.com.ar")).toBe("banco");
    expect(senderCategory("bbva.com.ar")).toBe("banco");
    expect(senderCategory("netflix.com")).toBe("streaming");
    expect(senderCategory("warnerbros.com")).toBe("streaming");
    expect(senderCategory("mercadolibre.com.ar")).toBe("e-commerce");
    expect(senderCategory("viagogo.com")).toBe("e-commerce");
  });

  it("lo que no está en la lista no se clasifica (no se lee el contenido)", () => {
    expect(senderCategory("github.com")).toBeNull();
    expect(senderCategory("duolingo.com")).toBeNull();
    // por el comienzo del nombre, no por cualquier parte
    expect(senderCategory("stackoverflow.com")).toBeNull();
    expect(senderCategory("macromedia.com")).toBeNull();
  });
});

describe("detectFilterLeaks", () => {
  const base = { now: NOW, userVerdicts: {} as Record<string, "empleo" | "no_empleo"> };

  it("un solo email de un dominio nunca visto alcanza para avisar", () => {
    const leaks = detectFilterLeaks({
      ...base,
      hosts: [host({ host: "mails.bancoejemplo.com.ar", firstAt: h(3), lastAt: h(3) })],
    });
    expect(leaks).toEqual([
      {
        domain: "bancoejemplo.com.ar",
        category: "banco",
        recent: 1,
        firstAt: h(3),
        hosts: ["mails.bancoejemplo.com.ar"],
      },
    ]);
  });

  it("junta los subdominios de un mismo dominio", () => {
    const leaks = detectFilterLeaks({
      ...base,
      hosts: [
        host({ host: "mails.bancoejemplo.com.ar", firstAt: h(10), recent: 3 }),
        host({ host: "comunicaciones.bancoejemplo.com.ar", firstAt: h(2), recent: 2 }),
      ],
    });
    expect(leaks).toHaveLength(1);
    expect(leaks[0]).toMatchObject({ domain: "bancoejemplo.com.ar", recent: 5, firstAt: h(10) });
    expect(leaks[0]!.hosts).toEqual([
      "comunicaciones.bancoejemplo.com.ar",
      "mails.bancoejemplo.com.ar",
    ]);
  });

  it("las fuentes esperadas no avisan nunca, tampoco los remitentes sociales de LinkedIn", () => {
    expect(EXPECTED_SOURCE_DOMAINS).toEqual(
      expect.arrayContaining(["linkedin.com", "getonbrd.com"]),
    );
    const leaks = detectFilterLeaks({
      ...base,
      hosts: [
        host({ host: "linkedin.com" }),
        host({ host: "e.linkedin.com" }),
        host({ host: "getonbrd.com" }),
      ],
    });
    expect(leaks).toEqual([]);
  });

  it("un dominio ya visto antes de las 48 h no vuelve a avisar", () => {
    const leaks = detectFilterLeaks({
      ...base,
      hosts: [host({ host: "github.com", firstAt: h(72), lastAt: h(1), recent: 4 })],
    });
    expect(leaks).toEqual([]);
  });

  it("si un subdominio ya se veía antes, el dominio entero cuenta como visto", () => {
    const leaks = detectFilterLeaks({
      ...base,
      hosts: [
        host({ host: "mails.bancoejemplo.com.ar", firstAt: h(100), lastAt: h(80), recent: 0 }),
        host({ host: "comunicaciones.bancoejemplo.com.ar", firstAt: h(2) }),
      ],
    });
    expect(leaks).toEqual([]);
  });

  it("lo que la persona marcó (fuente de empleo o no) deja de avisar", () => {
    const leaks = detectFilterLeaks({
      now: NOW,
      userVerdicts: { "indeed.com": "empleo", "netflix.com": "no_empleo" },
      hosts: [host({ host: "match.indeed.com" }), host({ host: "join.netflix.com" })],
    });
    expect(leaks).toEqual([]);
  });

  it("sin emails en las últimas 48 h no hay nada que avisar", () => {
    const leaks = detectFilterLeaks({
      ...base,
      hosts: [host({ host: "nuevo.example.org", firstAt: h(60), lastAt: h(60), recent: 0 })],
    });
    expect(leaks).toEqual([]);
  });

  it("escenario del 2026-09-18..21: habría avisado con el primer email del banco", () => {
    // Primer email de cada remitente, con el volumen bajo que no disparó el aviso de volumen
    const first = new Date("2026-09-18T15:08:46Z");
    const at = new Date("2026-09-18T15:10:00Z");
    const leaks = detectFilterLeaks({
      now: at,
      userVerdicts: {},
      hosts: [
        { host: "linkedin.com", firstAt: new Date("2026-09-18T11:08:22Z"), lastAt: at, recent: 3 },
        { host: "comunicaciones.bancoejemplo.com.ar", firstAt: first, lastAt: first, recent: 1 },
      ],
    });
    expect(leaks.map((l) => [l.domain, l.category])).toEqual([["bancoejemplo.com.ar", "banco"]]);
  });

  it("ordena primero lo categorizado y después por cantidad", () => {
    const leaks = detectFilterLeaks({
      ...base,
      hosts: [
        host({ host: "github.com", recent: 5 }),
        host({ host: "join.netflix.com", recent: 1 }),
        host({ host: "mails.bancoejemplo.com.ar", recent: 2 }),
      ],
    });
    expect(leaks.map((l) => l.domain)).toEqual([
      "bancoejemplo.com.ar",
      "netflix.com",
      "github.com",
    ]);
  });
});
