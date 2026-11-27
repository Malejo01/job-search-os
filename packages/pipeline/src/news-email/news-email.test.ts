import { describe, expect, it } from "vitest";
import { PRODUCT_NAME } from "../product";
import {
  buildNewsEmail,
  decideNewsEmail,
  NEWS_MAX_OFFERS,
  NEWS_MIN_DAYS_BETWEEN,
  newsEmailAllowed,
  newsEmailMode,
  newsWindowStart,
  type NewsOffer,
} from "./news-email";

const NOW = new Date("2026-12-07T13:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

describe("newsEmailMode / newsEmailAllowed", () => {
  it("apagado por defecto y ante cualquier valor raro", () => {
    for (const v of [undefined, "", "off", "1", "true", "si", "todos", "apagado"]) {
      expect(newsEmailMode({ NEWS_EMAIL: v }), String(v)).toBe("off");
    }
  });
  it("testers y all se reconocen sin importar mayúsculas ni espacios", () => {
    expect(newsEmailMode({ NEWS_EMAIL: " Testers " })).toBe("testers");
    expect(newsEmailMode({ NEWS_EMAIL: "ALL" })).toBe("all");
  });
  it("apagado no deja a nadie; all deja a todas; testers solo a la lista", () => {
    const env = {
      ADMIN_EMAILS: "admin@example.com",
      ASSISTANT_TESTER_EMAILS: "tester@example.com",
    };
    expect(newsEmailAllowed({ ...env, NEWS_EMAIL: "off" }, "admin@example.com")).toBe(false);
    expect(newsEmailAllowed({ ...env }, "admin@example.com")).toBe(false);
    expect(newsEmailAllowed({ ...env, NEWS_EMAIL: "all" }, "cualquiera@example.com")).toBe(true);
    expect(newsEmailAllowed({ ...env, NEWS_EMAIL: "testers" }, "Tester@Example.com")).toBe(true);
    expect(newsEmailAllowed({ ...env, NEWS_EMAIL: "testers" }, "admin@example.com")).toBe(true);
    expect(newsEmailAllowed({ ...env, NEWS_EMAIL: "testers" }, "otra@example.com")).toBe(false);
    expect(newsEmailAllowed({ ...env, NEWS_EMAIL: "testers" }, null)).toBe(false);
  });
});

describe("newsWindowStart", () => {
  it("sin envío previo, los últimos 7 días", () => {
    expect(newsWindowStart(null, NOW)).toEqual(daysAgo(7));
  });
  it("con un envío reciente, desde ese envío (no repite lo que ya se mandó)", () => {
    expect(newsWindowStart(daysAgo(3), NOW)).toEqual(daysAgo(3));
  });
  it("con un envío viejo, igual no mira más de 7 días atrás", () => {
    expect(newsWindowStart(daysAgo(40), NOW)).toEqual(daysAgo(7));
  });
});

describe("decideNewsEmail", () => {
  const base = { allowed: true, optedIn: true, lastSentAt: null, now: NOW, newOffers: 3 };
  it("manda con ofertas nuevas, permiso y sin envío reciente", () => {
    expect(decideNewsEmail(base)).toEqual({ send: true });
  });
  it("no manda si la variable lo apaga para esa persona", () => {
    expect(decideNewsEmail({ ...base, allowed: false })).toEqual({
      send: false,
      reason: "apagado",
    });
  });
  it("no manda si se dio de baja", () => {
    expect(decideNewsEmail({ ...base, optedIn: false })).toEqual({ send: false, reason: "baja" });
  });
  it("la baja gana aunque haya ofertas y permiso", () => {
    expect(decideNewsEmail({ ...base, optedIn: false, newOffers: 50 }).send).toBe(false);
  });
  it("si no hay ofertas nuevas no manda nada", () => {
    expect(decideNewsEmail({ ...base, newOffers: 0 })).toEqual({
      send: false,
      reason: "sin_novedades",
    });
    expect(decideNewsEmail({ ...base, newOffers: -1 }).send).toBe(false);
    expect(decideNewsEmail({ ...base, newOffers: Number.NaN }).send).toBe(false);
  });
  it("como mucho semanal: con un envío de hace menos de 6 días no manda", () => {
    expect(NEWS_MIN_DAYS_BETWEEN).toBe(6);
    expect(decideNewsEmail({ ...base, lastSentAt: daysAgo(2) })).toEqual({
      send: false,
      reason: "reciente",
    });
    expect(decideNewsEmail({ ...base, lastSentAt: daysAgo(5.9) }).send).toBe(false);
  });
  it("con un envío de hace 6 días o más, sí", () => {
    expect(decideNewsEmail({ ...base, lastSentAt: daysAgo(6) }).send).toBe(true);
    expect(decideNewsEmail({ ...base, lastSentAt: daysAgo(7) }).send).toBe(true);
  });
  it("un envío «en el futuro» (reloj raro) cuenta como reciente: falla cerrado", () => {
    expect(
      decideNewsEmail({ ...base, lastSentAt: new Date(NOW.getTime() + 86_400_000) }).send,
    ).toBe(false);
  });
});

describe("buildNewsEmail", () => {
  const offers: NewsOffer[] = [
    { id: "o1", title: "Abogada junior", company: "Empresa A", score: 8.34 },
    { id: "o2", title: "Analista legal", company: "Empresa B", score: 5.2 },
    { id: "o3", title: "Paralegal", company: null, score: 3.1 },
    { id: "o4", title: "Oficial de cumplimiento", company: "Empresa C", score: null },
  ];
  const input = {
    displayName: "Persona Ejemplo Apellido",
    careerLabels: ["Abogacía"],
    offers,
    total: 9,
    appUrl: "https://app.example/",
    unsubscribeUrl: "https://app.example/novedades/baja?t=abc",
    settingsUrl: "https://app.example/settings#novedades",
    contactEmail: "contacto@example.com",
    sealWords: {
      alta: "Afinidad alta",
      media: "Afinidad media",
      baja: "Afinidad baja",
      sin_evaluar: "Sin evaluar",
    },
    aclaracion: "Esta comparación usa la información del aviso y de tu perfil.",
  } as const;

  it("el asunto es neutro: sin números, sin carreras y sin títulos", () => {
    const { subject } = buildNewsEmail(input);
    expect(subject).toBe(`Ofertas nuevas en ${PRODUCT_NAME}`);
    expect(subject).not.toMatch(/\d/);
  });

  it("lista las ofertas con su sello y el puntaje con coma, y dice cuántas más hay", () => {
    const { text } = buildNewsEmail(input);
    expect(text).toContain("Abogada junior · Empresa A");
    expect(text).toContain("Afinidad alta, 8,3 de 10");
    expect(text).toContain("Afinidad media, 5,2 de 10");
    expect(text).toContain("Afinidad baja, 3,1 de 10");
    expect(text).toContain("Sin evaluar");
    expect(text).toContain("Paralegal");
    expect(text).toContain("y 5 más en la app");
    expect(text).toContain("https://app.example/jobs/o1");
  });

  it("nombra la carrera y la aclaración fija, y nunca promete trabajo", () => {
    const { text } = buildNewsEmail(input);
    expect(text).toContain("Abogacía");
    expect(text).toContain(input.aclaracion);
    expect(text).not.toMatch(/te vamos a conseguir|garantiz|seguro conseguís/i);
  });

  it("trae la baja en un clic, la preferencia en Ajustes y la decisión es de la persona", () => {
    const { text, html } = buildNewsEmail(input);
    expect(text).toContain("https://app.example/novedades/baja?t=abc");
    expect(text).toContain("https://app.example/settings#novedades");
    expect(text).toContain("nunca postulamos por vos");
    expect(html).toContain("https://app.example/novedades/baja?t=abc");
  });

  it("solo el primer nombre y nunca el email ni el apellido", () => {
    const { text } = buildNewsEmail(input);
    expect(text).toContain("Hola Persona:");
    expect(text).not.toContain("Apellido");
  });

  it("no pasa de NEWS_MAX_OFFERS ofertas aunque lleguen más", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      id: `m${i}`,
      title: `Oferta ficticia ${i}`,
      company: "Empresa A",
      score: 7,
    }));
    const { text } = buildNewsEmail({ ...input, offers: many, total: 12 });
    const shown = text.match(/Oferta ficticia \d+/g) ?? [];
    expect(shown.length).toBe(NEWS_MAX_OFFERS);
    expect(text).toContain(`y ${12 - NEWS_MAX_OFFERS} más en la app`);
  });

  it("el HTML escapa lo que viene de afuera (título y empresa de un aviso)", () => {
    const { html } = buildNewsEmail({
      ...input,
      offers: [
        { id: "x", title: '<img src=x onerror="alert(1)">', company: "<b>Empresa</b>", score: 6 },
      ],
      total: 1,
    });
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<b>Empresa</b>");
    expect(html).toContain("&lt;img");
  });

  it("un id raro no arma un enlace fuera de la app", () => {
    const { text } = buildNewsEmail({
      ...input,
      offers: [{ id: "../../evil?x=1#", title: "Oferta", company: null, score: null }],
      total: 1,
    });
    expect(text).not.toContain("evil");
    expect(text).toContain("https://app.example/jobs");
  });
});
