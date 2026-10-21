import { describe, expect, it } from "vitest";
import { CV_MAX_TEXT_CHARS, CV_MIN_TEXT_CHARS } from "./limits";
import { normalizeCvText } from "./normalize-text";

const pad = (s: string): string => s + " palabra".repeat(60);

describe("normalizeCvText", () => {
  it("rechaza textos cortos y largos", () => {
    expect(normalizeCvText("a".repeat(CV_MIN_TEXT_CHARS - 1))).toEqual({
      ok: false,
      error: "too_short",
    });
    expect(normalizeCvText("a".repeat(CV_MIN_TEXT_CHARS))).toMatchObject({ ok: true });
    expect(normalizeCvText("a".repeat(CV_MAX_TEXT_CHARS))).toMatchObject({ ok: true });
    expect(normalizeCvText("a".repeat(CV_MAX_TEXT_CHARS + 1))).toEqual({
      ok: false,
      error: "too_long",
    });
  });

  it("aplica NFC", () => {
    const r = normalizeCvText(pad("café"));
    expect(r.ok && r.value.startsWith("café")).toBe(true);
  });

  it("saca controles e invisibles pero deja \\n y \\t", () => {
    const r = normalizeCvText(pad("a\u0000b​c­﻿d‮e\u{e0041}\tf\ng"));
    expect(r.ok && r.value.startsWith("abcde\tf\ng")).toBe(true);
  });

  it("colapsa espacios y deja como mucho dos saltos seguidos", () => {
    const r = normalizeCvText(pad("a   b  c  \n\n\n\n\nd \r\n e"));
    expect(r.ok && r.value.startsWith("a b c\n\nd\ne")).toBe(true);
  });
});
