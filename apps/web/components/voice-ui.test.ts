import { describe, expect, it } from "vitest";
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
