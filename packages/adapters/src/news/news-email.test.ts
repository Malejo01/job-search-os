import { PRODUCT_NAME } from "@job-search-os/pipeline";
import { describe, expect, it } from "vitest";
import type { SendEmailParams } from "../email/resend";
import {
  NEWS_DAILY_CAP_DEFAULT,
  newsDailyCap,
  runNewsEmail,
  type NewsCandidate,
  type NewsStore,
} from "./news-email";
import { verifyNewsUnsubscribe } from "./unsubscribe-token";

const NOW = new Date("2026-12-07T13:00:00Z");
const SECRET = "secreto-de-prueba-largo-0123456789";
const ENV = {
  NEWS_EMAIL: "all",
  RESEND_API_KEY: "re_clave_de_prueba",
  EMAIL_FROM: "AfinIA Jobs <hola@ejemplo.test>",
  SITE_URL: "https://app.ejemplo.test",
  AUTH_SECRET: SECRET,
};
const LABELS = {
  careerLabel: (role: string) => (role === "abogacia" ? "Abogacía" : null),
  sealWords: {
    alta: "Afinidad alta",
    media: "Afinidad media",
    baja: "Afinidad baja",
    sin_evaluar: "Sin evaluar",
  },
  aclaracion: "Aclaración fija de prueba.",
};

const logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

const id = (n: number) => `e3200000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function cand(n: number, over: Partial<NewsCandidate> = {}): NewsCandidate {
  return {
    userId: id(n),
    email: `persona-${n}@ejemplo.test`,
    displayName: `Persona ${n}`,
    targetRoles: ["abogacia"],
    optedIn: true,
    newsEmailSentAt: null,
    ...over,
  };
}

type Offers = Record<
  string,
  { id: string; title: string; company: string | null; score: number | null }[]
>;

function fakeStore(
  candidates: NewsCandidate[],
  offers: Offers,
  over: { sentToday?: number; claims?: boolean } = {},
) {
  const calls = { loadOffers: [] as string[], claimed: [] as string[], released: [] as string[] };
  const store: NewsStore = {
    async loadCandidates() {
      return candidates;
    },
    async countSentSince() {
      return over.sentToday ?? 0;
    },
    async loadNewOffers(userId) {
      calls.loadOffers.push(userId);
      const list = offers[userId] ?? [];
      return { offers: list, total: list.length };
    },
    async claim(c) {
      if (over.claims === false) return false;
      calls.claimed.push(c.userId);
      return true;
    },
    async release(c) {
      calls.released.push(c.userId);
    },
  };
  return { store, calls };
}

const oneOffer = (n: number) => ({
  [id(n)]: [{ id: `job-${n}`, title: `Oferta ficticia ${n}`, company: "Empresa A", score: 7.5 }],
});

function recorder() {
  const sent: { params: SendEmailParams; apiKey: string }[] = [];
  const send = async (params: SendEmailParams, apiKey: string) => {
    sent.push({ params, apiKey });
  };
  return { sent, send };
}

describe("newsDailyCap", () => {
  it("usa el tope de la variable si es un entero válido y el de siempre si no", () => {
    expect(newsDailyCap("20")).toBe(20);
    for (const v of [undefined, "", "0", "-3", "abc", "1.5", "99999"]) {
      expect(newsDailyCap(v), String(v)).toBe(NEWS_DAILY_CAP_DEFAULT);
    }
  });
});

describe("runNewsEmail", () => {
  it("apagado: no lee la base ni manda nada", async () => {
    const { store, calls } = fakeStore([cand(1)], oneOffer(1));
    const { sent, send } = recorder();
    const out = await runNewsEmail({
      store,
      env: { ...ENV, NEWS_EMAIL: undefined },
      now: NOW,
      logger,
      send,
      labels: LABELS,
    });
    expect(out).toMatchObject({ ok: true, skipped: "apagado", sent: 0 });
    expect(sent).toHaveLength(0);
    expect(calls.loadOffers).toHaveLength(0);
  });

  it("sin clave de Resend, sin remitente o sin clave de firma: no manda ni marca a nadie", async () => {
    for (const env of [
      { ...ENV, RESEND_API_KEY: undefined },
      { ...ENV, EMAIL_FROM: undefined },
      { ...ENV, AUTH_SECRET: undefined },
    ]) {
      const { store, calls } = fakeStore([cand(1)], oneOffer(1));
      const { sent, send } = recorder();
      const out = await runNewsEmail({ store, env, now: NOW, logger, send, labels: LABELS });
      expect(out).toMatchObject({ ok: true, sent: 0 });
      expect(out.skipped).toBeDefined();
      expect(sent).toHaveLength(0);
      expect(calls.claimed).toHaveLength(0);
    }
  });

  it("manda un email a quien tiene ofertas nuevas, con la baja firmada y las cabeceras de baja en un clic", async () => {
    const { store, calls } = fakeStore([cand(1)], oneOffer(1));
    const { sent, send } = recorder();
    const out = await runNewsEmail({ store, env: ENV, now: NOW, logger, send, labels: LABELS });
    expect(out).toMatchObject({ ok: true, due: 1, sent: 1, failed: 0 });
    expect(calls.claimed).toEqual([id(1)]);
    const mail = sent[0]!;
    expect(mail.apiKey).toBe("re_clave_de_prueba");
    expect(mail.params.to).toBe("persona-1@ejemplo.test");
    expect(mail.params.subject).toBe(`Ofertas nuevas en ${PRODUCT_NAME}`);
    expect(mail.params.text).toContain("Oferta ficticia 1");
    expect(mail.params.text).toContain("Abogacía");
    expect(mail.params.text).toContain("Afinidad alta, 7,5 de 10");
    // El enlace de baja verifica y es el de esa persona
    const url = /https:\/\/app\.ejemplo\.test\/novedades\/baja\?t=([^\s>]+)/.exec(
      mail.params.text ?? "",
    );
    expect(url).not.toBeNull();
    expect(verifyNewsUnsubscribe(url![1], SECRET)).toBe(id(1));
    expect(mail.params.headers?.["List-Unsubscribe"]).toContain("/novedades/baja?t=");
    expect(mail.params.headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    // El logger y la respuesta no llevan el email
    expect(JSON.stringify(out)).not.toContain("@");
  });

  it("sin ofertas nuevas no manda nada ni marca", async () => {
    const { store, calls } = fakeStore([cand(1)], {});
    const { sent, send } = recorder();
    const out = await runNewsEmail({ store, env: ENV, now: NOW, logger, send, labels: LABELS });
    expect(out).toMatchObject({ ok: true, sent: 0, due: 0 });
    expect(out.skippedBy).toMatchObject({ sin_novedades: 1 });
    expect(sent).toHaveLength(0);
    expect(calls.claimed).toHaveLength(0);
  });

  it("quien se dio de baja no recibe nada, aunque tenga ofertas nuevas", async () => {
    const { store, calls } = fakeStore([cand(1, { optedIn: false })], oneOffer(1));
    const { sent, send } = recorder();
    const out = await runNewsEmail({ store, env: ENV, now: NOW, logger, send, labels: LABELS });
    expect(out.sent).toBe(0);
    expect(out.skippedBy).toMatchObject({ baja: 1 });
    expect(sent).toHaveLength(0);
    expect(calls.claimed).toHaveLength(0);
  });

  it("como mucho semanal: con un envío de hace 2 días no manda ni busca ofertas", async () => {
    const recent = new Date(NOW.getTime() - 2 * 86_400_000);
    const { store, calls } = fakeStore([cand(1, { newsEmailSentAt: recent })], oneOffer(1));
    const { sent, send } = recorder();
    const out = await runNewsEmail({ store, env: ENV, now: NOW, logger, send, labels: LABELS });
    expect(out.sent).toBe(0);
    expect(out.skippedBy).toMatchObject({ reciente: 1 });
    expect(sent).toHaveLength(0);
    expect(calls.loadOffers).toHaveLength(0);
  });

  it("con testers, solo a la lista", async () => {
    const env = {
      ...ENV,
      NEWS_EMAIL: "testers",
      ASSISTANT_TESTER_EMAILS: "persona-2@ejemplo.test",
    };
    const { store } = fakeStore([cand(1), cand(2)], { ...oneOffer(1), ...oneOffer(2) });
    const { sent, send } = recorder();
    const out = await runNewsEmail({ store, env, now: NOW, logger, send, labels: LABELS });
    expect(out.sent).toBe(1);
    expect(sent.map((s) => s.params.to)).toEqual(["persona-2@ejemplo.test"]);
    expect(out.skippedBy).toMatchObject({ apagado: 1 });
  });

  it("respeta el tope diario", async () => {
    const cands = [cand(1), cand(2), cand(3)];
    const offers = { ...oneOffer(1), ...oneOffer(2), ...oneOffer(3) };
    const { store } = fakeStore(cands, offers, { sentToday: 8 });
    const { sent, send } = recorder();
    const out = await runNewsEmail({
      store,
      env: { ...ENV, NEWS_EMAIL_DAILY_CAP: "10" },
      now: NOW,
      logger,
      send,
      labels: LABELS,
    });
    expect(out.sent).toBe(2);
    expect(sent).toHaveLength(2);
    const none = fakeStore(cands, offers, { sentToday: 10 });
    const out2 = await runNewsEmail({
      store: none.store,
      env: { ...ENV, NEWS_EMAIL_DAILY_CAP: "10" },
      now: NOW,
      logger,
      send,
      labels: LABELS,
    });
    expect(out2).toMatchObject({ skipped: "tope_diario", sent: 0 });
  });

  it("si otra corrida ya la reclamó, no manda", async () => {
    const { store } = fakeStore([cand(1)], oneOffer(1), { claims: false });
    const { sent, send } = recorder();
    const out = await runNewsEmail({ store, env: ENV, now: NOW, logger, send, labels: LABELS });
    expect(out).toMatchObject({ sent: 0, raced: 1 });
    expect(sent).toHaveLength(0);
  });

  it("si el envío falla, devuelve la marca y sigue con la siguiente persona", async () => {
    const { store, calls } = fakeStore([cand(1), cand(2)], { ...oneOffer(1), ...oneOffer(2) });
    const sent: string[] = [];
    const send = async (p: SendEmailParams) => {
      if (p.to === "persona-1@ejemplo.test")
        throw new Error("Resend POST /emails: HTTP 500 cuerpo con persona-1@ejemplo.test");
      sent.push(p.to);
    };
    const out = await runNewsEmail({ store, env: ENV, now: NOW, logger, send, labels: LABELS });
    expect(out).toMatchObject({ sent: 1, failed: 1 });
    expect(calls.released).toEqual([id(1)]);
    expect(sent).toEqual(["persona-2@ejemplo.test"]);
  });

  it("corta la corrida tras demasiados fallos seguidos", async () => {
    const cands = Array.from({ length: 9 }, (_, i) => cand(i + 1));
    const offers = Object.assign({}, ...cands.map((_, i) => oneOffer(i + 1)));
    const { store } = fakeStore(cands, offers);
    const send = async () => {
      throw new Error("Resend POST /emails: HTTP 429");
    };
    const out = await runNewsEmail({ store, env: ENV, now: NOW, logger, send, labels: LABELS });
    expect(out.sent).toBe(0);
    expect(out.failed).toBe(5);
  });

  it("una carrera que el catálogo no conoce no rompe el email ni se nombra", async () => {
    const { store } = fakeStore([cand(1, { targetRoles: ["carrera_rara"] })], oneOffer(1));
    const { sent, send } = recorder();
    await runNewsEmail({ store, env: ENV, now: NOW, logger, send, labels: LABELS });
    expect(sent[0]!.params.text).not.toContain("carrera_rara");
  });
});
