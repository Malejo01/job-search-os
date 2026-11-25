import { afterEach, describe, expect, it, vi } from "vitest";

const roles = vi.hoisted(() => ({
  email: null as string | null,
  env: {} as Record<string, string>,
}));
vi.mock("@/lib/profile-agent/access", () => ({ getSessionEmail: async () => roles.email }));
vi.mock("../lib/user-roles", () => ({
  testerEnvFor: async () => ({ ...process.env, ...roles.env }),
}));

import { voiceDailySecondsFor } from "../lib/voice/server";
import {
  VOICE_PRIVACY_BROWSER,
  VOICE_PRIVACY_SERVER,
  barScale,
  formatElapsed,
  levelDigit,
  voicePrivacyNote,
} from "../lib/voice/voice-ui";

describe("voice-ui", () => {
  it("formatea el contador", () => {
    expect(formatElapsed(0)).toBe("0:00");
    expect(formatElapsed(9_999)).toBe("0:09");
    expect(formatElapsed(105_000)).toBe("1:45");
    expect(formatElapsed(-5)).toBe("0:00");
  });

  it("las barras quedan casi planas en silencio y llegan a 1", () => {
    expect(barScale(0)).toBeCloseTo(0.12);
    expect(barScale(0.02)).toBeLessThan(0.2);
    expect(barScale(1)).toBe(1);
    expect(barScale(5)).toBe(1);
  });

  it("el nivel en número va de 0 a 9", () => {
    expect(levelDigit(0)).toBe(0);
    expect(levelDigit(1)).toBe(9);
    expect(levelDigit(0.3)).toBeGreaterThan(0);
  });

  it("el aviso de privacidad cambia según el camino", () => {
    expect(voicePrivacyNote("browser", false)).toBe(VOICE_PRIVACY_BROWSER);
    expect(voicePrivacyNote(null, false)).toBe(VOICE_PRIVACY_BROWSER);
    expect(voicePrivacyNote("record", true)).toBe(VOICE_PRIVACY_SERVER);
    expect(voicePrivacyNote("browser", true)).toMatch(/Gemini/);
    expect(VOICE_PRIVACY_SERVER).toMatch(/descarta/);
  });
});

describe("voiceDailySecondsFor · cupo según el rol (R29-06)", () => {
  afterEach(() => {
    roles.email = null;
    roles.env = {};
    vi.unstubAllEnvs();
  });

  it("una tester de la lista tiene 60 minutos y una persona común 20", async () => {
    roles.email = "tester@example.com";
    roles.env = { ASSISTANT_TESTER_EMAILS: "tester@example.com" };
    expect(await voiceDailySecondsFor("u-tester")).toBe(3600);
    roles.email = "comun@example.com";
    expect(await voiceDailySecondsFor("u-comun")).toBe(1200);
  });

  it("sin email en la sesión es una persona común", async () => {
    roles.email = null;
    expect(await voiceDailySecondsFor("u-sin-email")).toBe(1200);
  });

  it("VOICE_TESTER_DAILY_MINUTES cambia solo el cupo de la tester", async () => {
    vi.stubEnv("VOICE_TESTER_DAILY_MINUTES", "30");
    roles.email = "tester@example.com";
    roles.env = { ASSISTANT_TESTER_EMAILS: "tester@example.com" };
    expect(await voiceDailySecondsFor("u-tester")).toBe(1800);
    roles.email = "comun@example.com";
    expect(await voiceDailySecondsFor("u-comun")).toBe(1200);
  });
});
