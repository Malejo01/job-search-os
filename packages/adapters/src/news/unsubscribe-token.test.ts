import { describe, expect, it } from "vitest";
import {
  NEWS_UNSUBSCRIBE_TTL_DAYS,
  newsEmailSecret,
  newsUnsubscribeUrl,
  signNewsUnsubscribe,
  verifyNewsUnsubscribe,
} from "./unsubscribe-token";

const SECRET = "secreto-de-prueba-largo-0123456789";
const OTHER_SECRET = "otro-secreto-de-prueba-largo-9876543210";
const USER = "e3200000-0000-4000-8000-0000000000a1";
const OTHER_USER = "e3200000-0000-4000-8000-0000000000a2";
const NOW = new Date("2026-12-07T13:00:00Z");
const daysAfter = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

describe("token de baja del email de novedades", () => {
  it("firma y verifica: devuelve la persona", () => {
    const token = signNewsUnsubscribe(USER, SECRET, NOW);
    expect(verifyNewsUnsubscribe(token, SECRET, daysAfter(1))).toBe(USER);
  });

  it("es determinista y no deja ver nada más que el id y el vencimiento", () => {
    expect(signNewsUnsubscribe(USER, SECRET, NOW)).toBe(signNewsUnsubscribe(USER, SECRET, NOW));
    expect(signNewsUnsubscribe(USER, SECRET, NOW)).not.toBe(
      signNewsUnsubscribe(OTHER_USER, SECRET, NOW),
    );
    expect(signNewsUnsubscribe(USER, SECRET, NOW)).not.toContain("@");
  });

  it("vence a los 90 días: antes sirve, después falla cerrado", () => {
    const token = signNewsUnsubscribe(USER, SECRET, NOW);
    expect(verifyNewsUnsubscribe(token, SECRET, daysAfter(NEWS_UNSUBSCRIBE_TTL_DAYS - 1))).toBe(
      USER,
    );
    expect(
      verifyNewsUnsubscribe(token, SECRET, daysAfter(NEWS_UNSUBSCRIBE_TTL_DAYS + 1)),
    ).toBeNull();
  });

  it("no se puede estirar el vencimiento: cambiarlo invalida la firma", () => {
    const [id, exp, sig] = signNewsUnsubscribe(USER, SECRET, NOW).split(".");
    const longer = `${id}.${Number(exp) + 10 * 365 * 86_400}.${sig}`;
    expect(verifyNewsUnsubscribe(longer, SECRET, daysAfter(200))).toBeNull();
  });

  it("falla cerrado ante otra clave, un id cambiado o una firma cortada", () => {
    const token = signNewsUnsubscribe(USER, SECRET, NOW);
    expect(verifyNewsUnsubscribe(token, OTHER_SECRET, NOW)).toBeNull();
    const [, exp, sig] = token.split(".");
    expect(verifyNewsUnsubscribe(`${OTHER_USER}.${exp}.${sig}`, SECRET, NOW)).toBeNull();
    expect(verifyNewsUnsubscribe(token.slice(0, -2), SECRET, NOW)).toBeNull();
    expect(verifyNewsUnsubscribe(`${token}x`, SECRET, NOW)).toBeNull();
  });

  it("falla cerrado ante basura, vacío o sin clave", () => {
    for (const bad of [
      "",
      ".",
      "abc",
      "a.b.c",
      "a.b.c.d",
      "no-es-un-uuid.123.firma",
      `${USER}.123.`,
      `${USER}.abc.${"a".repeat(43)}`,
      `.123.${"a".repeat(43)}`,
      `${USER}.${"a".repeat(43)}`,
    ]) {
      expect(verifyNewsUnsubscribe(bad, SECRET, NOW), bad).toBeNull();
    }
    expect(verifyNewsUnsubscribe(signNewsUnsubscribe(USER, SECRET, NOW), "", NOW)).toBeNull();
    expect(verifyNewsUnsubscribe(undefined, SECRET, NOW)).toBeNull();
  });

  it("no firma con una clave vacía o demasiado corta", () => {
    expect(() => signNewsUnsubscribe(USER, "")).toThrow();
    expect(() => signNewsUnsubscribe(USER, "corta")).toThrow();
  });

  it("no firma un id que no sea un uuid", () => {
    expect(() => signNewsUnsubscribe("no-uuid", SECRET)).toThrow();
  });
});

describe("newsEmailSecret", () => {
  it("usa NEWS_EMAIL_SECRET y, si falta, AUTH_SECRET", () => {
    expect(newsEmailSecret({ NEWS_EMAIL_SECRET: SECRET, AUTH_SECRET: OTHER_SECRET })).toBe(SECRET);
    expect(newsEmailSecret({ AUTH_SECRET: OTHER_SECRET })).toBe(OTHER_SECRET);
  });
  it("sin clave o con una demasiado corta, null (el envío no sale y la baja no se acepta)", () => {
    expect(newsEmailSecret({})).toBeNull();
    expect(newsEmailSecret({ AUTH_SECRET: "corta" })).toBeNull();
  });
});

describe("newsUnsubscribeUrl", () => {
  it("arma el enlace de baja con el token en la URL", () => {
    const url = newsUnsubscribeUrl("https://app.example/", USER, SECRET, NOW);
    expect(url.startsWith("https://app.example/novedades/baja?t=")).toBe(true);
    const token = new URL(url).searchParams.get("t")!;
    expect(verifyNewsUnsubscribe(token, SECRET, NOW)).toBe(USER);
  });
});
