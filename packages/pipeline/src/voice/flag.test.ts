import { describe, expect, it } from "vitest";
import { voiceServerAllowed, voiceServerMode } from "./flag";

describe("voiceServerMode", () => {
  it("sin variable o con un valor inválido está apagado", () => {
    expect(voiceServerMode({})).toBe("off");
    for (const v of ["", "1", "true", "on", "si", "apagado", "testerss", "all testers"]) {
      expect(voiceServerMode({ VOICE_SERVER_TRANSCRIBE: v })).toBe("off");
    }
  });

  it("acepta testers y all sin importar mayúsculas ni espacios", () => {
    expect(voiceServerMode({ VOICE_SERVER_TRANSCRIBE: "testers" })).toBe("testers");
    expect(voiceServerMode({ VOICE_SERVER_TRANSCRIBE: " All " })).toBe("all");
    expect(voiceServerMode({ VOICE_SERVER_TRANSCRIBE: "OFF" })).toBe("off");
  });
});

describe("voiceServerAllowed", () => {
  const env = {
    ADMIN_EMAILS: "admin@example.com",
    ASSISTANT_TESTER_EMAILS: "tester@example.com",
  };

  it("apagado: nadie, ni admin", () => {
    expect(voiceServerAllowed(env, "admin@example.com")).toBe(false);
    expect(
      voiceServerAllowed({ ...env, VOICE_SERVER_TRANSCRIBE: "off" }, "admin@example.com"),
    ).toBe(false);
  });

  it("testers: solo ADMIN_EMAILS y ASSISTANT_TESTER_EMAILS", () => {
    const e = { ...env, VOICE_SERVER_TRANSCRIBE: "testers" };
    expect(voiceServerAllowed(e, "admin@example.com")).toBe(true);
    expect(voiceServerAllowed(e, "TESTER@example.com")).toBe(true);
    expect(voiceServerAllowed(e, "otra@example.com")).toBe(false);
    expect(voiceServerAllowed(e, null)).toBe(false);
    expect(voiceServerAllowed(e, undefined)).toBe(false);
  });

  it("all: cualquier persona con sesión", () => {
    const e = { ...env, VOICE_SERVER_TRANSCRIBE: "all" };
    expect(voiceServerAllowed(e, "otra@example.com")).toBe(true);
  });
});
