import { describe, expect, it } from "vitest";
import { CV_TICKET_TTL_MS, originAllowed, signCvTicket, verifyCvTicket } from "./ticket";

const SECRET = "secreto-de-prueba";
const USER = "a0000000-0000-4000-8000-000000000001";
const OTHER = "a0000000-0000-4000-8000-000000000002";
const T = { conversationId: "0123456789ab", turns: 4 };
const NOW = 1_800_000_000_000;

describe("ticket del chat de CV", () => {
  it("ida y vuelta", () => {
    const t = signCvTicket(SECRET, USER, T, NOW)!;
    expect(verifyCvTicket(SECRET, USER, t, NOW + 1000)).toEqual(T);
  });

  it("falla cerrado: otro usuario, otro secreto, manipulado, vencido o sin secreto", () => {
    const t = signCvTicket(SECRET, USER, T, NOW)!;
    expect(verifyCvTicket(SECRET, OTHER, t, NOW)).toBeNull();
    expect(verifyCvTicket("otro", USER, t, NOW)).toBeNull();
    const [id, , exp, mac] = t.split(".");
    expect(verifyCvTicket(SECRET, USER, `${id}.0.${exp}.${mac}`, NOW)).toBeNull();
    expect(verifyCvTicket(SECRET, USER, t, NOW + CV_TICKET_TTL_MS + 1)).toBeNull();
    expect(signCvTicket(undefined, USER, T, NOW)).toBeNull();
    expect(verifyCvTicket(undefined, USER, t, NOW)).toBeNull();
    expect(verifyCvTicket(SECRET, USER, 12, NOW)).toBeNull();
    expect(verifyCvTicket(SECRET, USER, "a.b.c", NOW)).toBeNull();
  });
});

describe("originAllowed", () => {
  const allowed = ["https://busqueda.example.test", "http://localhost:3100"];
  it("acepta solo orígenes propios", () => {
    expect(originAllowed("http://localhost:3100", allowed)).toBe(true);
    expect(originAllowed("https://busqueda.example.test", allowed)).toBe(true);
    expect(originAllowed("https://otro.example.test", allowed)).toBe(false);
    expect(originAllowed(null, allowed)).toBe(false);
    expect(originAllowed("no es una url", allowed)).toBe(false);
  });
});
