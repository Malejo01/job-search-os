import { describe, expect, it } from "vitest";
import {
  VOICE_DEFAULT_DAILY_SECONDS,
  VOICE_MAX_BYTES,
  VOICE_MAX_SECONDS,
  VOICE_WARN_SECONDS,
  normalizeAudioType,
  parseVoiceLabel,
  voiceDailySeconds,
  voiceLabel,
  voiceQuotaDecision,
  voiceReserveUsd,
  validateVoiceUpload,
} from "./limits";

const webm = (n = 4000) => {
  const b = new Uint8Array(n);
  b.set([0x1a, 0x45, 0xdf, 0xa3]);
  return b;
};
const ogg = (n = 4000) => {
  const b = new Uint8Array(n);
  b.set([0x4f, 0x67, 0x67, 0x53]);
  return b;
};
const mp4 = (n = 4000) => {
  const b = new Uint8Array(n);
  b.set([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70]);
  return b;
};

describe("constantes", () => {
  it("son las del contrato", () => {
    expect(VOICE_MAX_BYTES).toBe(2 * 1024 * 1024);
    expect(VOICE_MAX_SECONDS).toBe(120);
    expect(VOICE_WARN_SECONDS).toBe(105);
    expect(VOICE_DEFAULT_DAILY_SECONDS).toBe(1200);
  });
});

describe("voiceDailySeconds", () => {
  it("sin variable son 20 minutos", () => {
    expect(voiceDailySeconds({})).toBe(1200);
  });
  it("lee VOICE_DAILY_MINUTES en minutos", () => {
    expect(voiceDailySeconds({ VOICE_DAILY_MINUTES: "5" })).toBe(300);
  });
  it("inválido, cero, negativo, decimal o fuera de rango vuelve al default", () => {
    for (const v of ["", "0", "-3", "1.5", "abc", "1e3", "99999"]) {
      expect(voiceDailySeconds({ VOICE_DAILY_MINUTES: v })).toBe(1200);
    }
  });
});

describe("normalizeAudioType", () => {
  it("saca los parámetros y deja el tipo base", () => {
    expect(normalizeAudioType("audio/webm;codecs=opus")).toBe("audio/webm");
    expect(normalizeAudioType(" Audio/OGG ; codecs=opus")).toBe("audio/ogg");
    expect(normalizeAudioType("audio/mp4")).toBe("audio/mp4");
  });
  it("rechaza todo lo demás", () => {
    for (const t of [
      "",
      "video/webm",
      "audio/wav",
      "audio/mpeg",
      "text/plain",
      "application/pdf",
    ]) {
      expect(normalizeAudioType(t)).toBeNull();
    }
  });
});

describe("validateVoiceUpload", () => {
  const ok = { type: "audio/webm;codecs=opus", bytes: webm(), durationMs: 10_000 };

  it("acepta webm, ogg y mp4 con su firma", () => {
    expect(validateVoiceUpload(ok)).toEqual({ ok: true, mime: "audio/webm", seconds: 10 });
    expect(
      validateVoiceUpload({ type: "audio/ogg", bytes: ogg(), durationMs: 5_000 }),
    ).toMatchObject({ ok: true, mime: "audio/ogg" });
    expect(
      validateVoiceUpload({ type: "audio/mp4", bytes: mp4(), durationMs: 5_000 }),
    ).toMatchObject({ ok: true, mime: "audio/mp4" });
  });

  it("redondea los segundos hacia arriba", () => {
    expect(validateVoiceUpload({ ...ok, durationMs: 10_001 })).toMatchObject({ seconds: 11 });
  });

  it("rechaza vacío y tamaño de más", () => {
    expect(validateVoiceUpload({ ...ok, bytes: new Uint8Array(0) })).toEqual({
      ok: false,
      reason: "empty",
    });
    expect(
      validateVoiceUpload({ ...ok, bytes: webm(VOICE_MAX_BYTES + 1), durationMs: 120_000 }),
    ).toEqual({ ok: false, reason: "too_large" });
    expect(
      validateVoiceUpload({ ...ok, bytes: webm(VOICE_MAX_BYTES), durationMs: 120_000 }),
    ).not.toMatchObject({ reason: "too_large" });
  });

  it("rechaza un tipo no permitido o que no coincide con la firma", () => {
    expect(validateVoiceUpload({ ...ok, type: "audio/wav" })).toEqual({
      ok: false,
      reason: "type",
    });
    // dice webm pero son bytes de otra cosa
    expect(validateVoiceUpload({ ...ok, bytes: ogg() })).toEqual({
      ok: false,
      reason: "signature",
    });
    expect(validateVoiceUpload({ ...ok, bytes: new Uint8Array(4000).fill(7) })).toEqual({
      ok: false,
      reason: "signature",
    });
  });

  it("rechaza duraciones inválidas o de más", () => {
    for (const d of [Number.NaN, Infinity, -1, 0, 100]) {
      expect(validateVoiceUpload({ ...ok, durationMs: d })).toEqual({
        ok: false,
        reason: "duration",
      });
    }
    expect(validateVoiceUpload({ ...ok, durationMs: 130_000 })).toEqual({
      ok: false,
      reason: "too_long",
    });
  });

  it("tolera un segundo y medio de más y cuenta como máximo 120 s", () => {
    expect(validateVoiceUpload({ ...ok, durationMs: 121_000 })).toMatchObject({
      ok: true,
      seconds: 120,
    });
  });

  it("rechaza demasiados bytes por segundo (duración declarada mentirosa para colar un archivo)", () => {
    expect(validateVoiceUpload({ ...ok, bytes: webm(1_500_000), durationMs: 2_000 })).toEqual({
      ok: false,
      reason: "too_dense",
    });
    // 2 MB en 120 s está dentro
    expect(
      validateVoiceUpload({ ...ok, bytes: webm(VOICE_MAX_BYTES), durationMs: 120_000 }).ok,
    ).toBe(true);
  });
});

describe("voiceQuotaDecision", () => {
  const base = { usedSeconds: 0, reservedSeconds: 0, requestSeconds: 60, dailySeconds: 1200 };

  it("deja pasar mientras entre en el cupo", () => {
    expect(voiceQuotaDecision(base)).toEqual({ ok: true, remainingSeconds: 1140 });
  });

  it("cuenta lo usado y lo reservado", () => {
    expect(
      voiceQuotaDecision({ ...base, usedSeconds: 1000, reservedSeconds: 100, requestSeconds: 120 }),
    ).toEqual({
      ok: false,
      remainingSeconds: 100,
    });
  });

  it("deja usar el cupo justo y frena un segundo más", () => {
    expect(voiceQuotaDecision({ ...base, usedSeconds: 1140 }).ok).toBe(true);
    expect(voiceQuotaDecision({ ...base, usedSeconds: 1141 })).toMatchObject({ ok: false });
  });

  it("falla cerrado con números inválidos", () => {
    expect(voiceQuotaDecision({ ...base, usedSeconds: Number.NaN }).ok).toBe(false);
    expect(voiceQuotaDecision({ ...base, requestSeconds: Number.NaN }).ok).toBe(false);
    expect(voiceQuotaDecision({ ...base, dailySeconds: Number.NaN }).ok).toBe(false);
    expect(voiceQuotaDecision({ ...base, requestSeconds: 0 }).ok).toBe(false);
  });
});

describe("voiceReserveUsd", () => {
  it("crece con los segundos, con un piso", () => {
    expect(voiceReserveUsd(1)).toBeGreaterThan(0);
    expect(voiceReserveUsd(120)).toBeGreaterThan(voiceReserveUsd(10));
    expect(voiceReserveUsd(120)).toBeLessThan(0.1);
  });
});

describe("voiceLabel", () => {
  it("lleva los segundos y vuelve a leerse", () => {
    const l = voiceLabel(95, "abc123");
    expect(l).toBe("voice:95:abc123");
    expect(parseVoiceLabel(l)).toEqual({ seconds: 95, requestId: "abc123" });
  });
  it("ignora etiquetas que no son de voz o están mal formadas", () => {
    for (const l of [null, "", "cv_tailor:x", "voice:", "voice:x:y", "voice:-3:y", "voice:5"]) {
      expect(parseVoiceLabel(l)).toBeNull();
    }
  });
});
