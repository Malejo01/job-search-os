import { describe, expect, it } from "vitest";
import {
  FEEDBACK_ACTIONS_MAX,
  FEEDBACK_ACTION_TEXT_MAX,
  FEEDBACK_CONTEXT_MAX_BYTES,
  FEEDBACK_DAILY_LIMIT,
  FEEDBACK_MESSAGE_MAX,
  FEEDBACK_PATH_MAX,
  isOverDailyLimit,
  isValidFeedbackPath,
  normalizeFeedbackMessage,
  normalizeFeedbackPath,
  pushAction,
  validateFeedback,
  validateFeedbackContext,
  type FeedbackAction,
} from "./beta-feedback";

describe("isValidFeedbackPath", () => {
  it("acepta pathnames simples", () => {
    for (const p of ["/", "/hoy", "/jobs/abc-123", "/settings/metricas"]) {
      expect(isValidFeedbackPath(p), p).toBe(true);
    }
  });

  it("rechaza query, fragmento, .., barra doble, relativos y control", () => {
    for (const p of [
      "",
      "hoy",
      "/jobs?id=1",
      "/jobs#x",
      "/a/../b",
      "//otro.test",
      "/a\\b",
      "/a\nb",
      "https://ejemplo.test/hoy",
    ]) {
      expect(isValidFeedbackPath(p), p).toBe(false);
    }
  });

  it("respeta el largo máximo", () => {
    expect(isValidFeedbackPath("/" + "a".repeat(FEEDBACK_PATH_MAX - 1))).toBe(true);
    expect(isValidFeedbackPath("/" + "a".repeat(FEEDBACK_PATH_MAX))).toBe(false);
  });

  it("rechaza lo que no es texto", () => {
    expect(isValidFeedbackPath(null)).toBe(false);
    expect(isValidFeedbackPath(42)).toBe(false);
  });
});

describe("normalizeFeedbackPath", () => {
  it("cambia uuids y segmentos numéricos por [id]", () => {
    expect(normalizeFeedbackPath("/jobs/3f2b8c1e-9a4d-4e7b-8c21-5d6e7f8a9b0c")).toBe("/jobs/[id]");
    expect(normalizeFeedbackPath("/applications/12345/edit")).toBe("/applications/[id]/edit");
    expect(normalizeFeedbackPath("/JOBS/3F2B8C1E-9A4D-4E7B-8C21-5D6E7F8A9B0C")).toBe("/JOBS/[id]");
  });

  it("deja igual lo que no es un id", () => {
    expect(normalizeFeedbackPath("/")).toBe("/");
    expect(normalizeFeedbackPath("/jobs/pending-jd")).toBe("/jobs/pending-jd");
    expect(normalizeFeedbackPath("/plan/2026-abc")).toBe("/plan/2026-abc");
  });
});

describe("normalizeFeedbackMessage", () => {
  it("saca los caracteres bidireccionales e invisibles", () => {
    const letras = ["a", "b", "c", "d", "e", "f", "g", "h"];
    // U+200B, U+200E, U+202A, U+202E, U+2066, U+2069, U+FEFF entre las letras
    const invisibles = [0x200b, 0x200e, 0x202a, 0x202e, 0x2066, 0x2069, 0xfeff].map((c) =>
      String.fromCodePoint(c),
    );
    const sucio = letras.map((l, i) => l + (invisibles[i] ?? "")).join("");
    expect(sucio).not.toBe("abcdefgh");
    expect(normalizeFeedbackMessage(sucio)).toBe("abcdefgh");
  });

  it("unifica saltos de línea y recorta", () => {
    expect(normalizeFeedbackMessage("  hola\r\nchau\rfin  ")).toBe("hola\nchau\nfin");
  });
});

describe("validateFeedback", () => {
  const ok = { category: "idea", message: "Una idea", path: "/hoy" };

  it("acepta y normaliza mensaje y ruta", () => {
    expect(validateFeedback({ ...ok, message: "  hola\r\nchau  ", path: "/jobs/12345" })).toEqual({
      ok: true,
      value: { category: "idea", message: "hola\nchau", path: "/jobs/[id]", context: null },
    });
  });

  it("acepta contexto válido y lo valida", () => {
    const res = validateFeedback({
      ...ok,
      context: {
        pathname: "/hoy",
        actions: [{ type: "click", text: "Guardar", time: "2026-10-30T10:00:00Z" }],
      },
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.context?.pathname).toBe("/hoy");
      expect(res.value.context?.actions?.[0]?.text).toBe("Guardar");
    }
  });

  it("devuelve el primer campo inválido, sin contenido", () => {
    expect(validateFeedback({ ...ok, category: "otra" })).toEqual({ ok: false, field: "category" });
    expect(validateFeedback({ ...ok, message: "   " })).toEqual({ ok: false, field: "message" });
    expect(validateFeedback({ ...ok, message: String.fromCodePoint(0x200b, 0xfeff) })).toEqual({
      ok: false,
      field: "message",
    });
    expect(validateFeedback({ ...ok, message: 5 })).toEqual({ ok: false, field: "message" });
    expect(validateFeedback({ ...ok, path: "/a?b=1" })).toEqual({ ok: false, field: "path" });
  });

  it("el mensaje llega hasta el máximo y no más", () => {
    expect(validateFeedback({ ...ok, message: "x".repeat(FEEDBACK_MESSAGE_MAX) }).ok).toBe(true);
    expect(validateFeedback({ ...ok, message: "x".repeat(FEEDBACK_MESSAGE_MAX + 1) }).ok).toBe(
      false,
    );
  });
});

describe("isOverDailyLimit", () => {
  it("bloquea desde el décimo envío ya hecho", () => {
    expect(isOverDailyLimit(FEEDBACK_DAILY_LIMIT - 1)).toBe(false);
    expect(isOverDailyLimit(FEEDBACK_DAILY_LIMIT)).toBe(true);
  });
});

describe("pushAction", () => {
  it("agrega acciones respetando el tope de 10 (FIFO)", () => {
    let buf: FeedbackAction[] = [];
    for (let i = 1; i <= 15; i++) {
      buf = pushAction(buf, { type: "click", text: `Accion ${i}` });
    }
    expect(buf).toHaveLength(FEEDBACK_ACTIONS_MAX);
    expect(buf[0]?.text).toBe("Accion 6");
    expect(buf[FEEDBACK_ACTIONS_MAX - 1]?.text).toBe("Accion 15");
  });

  it("trunca el texto a 60 caracteres y colapsa espacios", () => {
    const largo = "   " + "x".repeat(100) + "   ";
    const buf = pushAction([], { type: "click", text: largo });
    expect(buf).toHaveLength(1);
    expect(buf[0]?.text).toBe("x".repeat(FEEDBACK_ACTION_TEXT_MAX));
  });

  it("ignora acciones con texto vacío", () => {
    const buf = pushAction([], { type: "click", text: "   " });
    expect(buf).toHaveLength(0);
  });
});

describe("validateFeedbackContext", () => {
  it("acepta null, undefined y vacío devolviendo null", () => {
    expect(validateFeedbackContext(null)).toEqual({ ok: true, value: null });
    expect(validateFeedbackContext(undefined)).toEqual({ ok: true, value: null });
    expect(validateFeedbackContext("")).toEqual({ ok: true, value: null });
  });

  it("parsea JSON string y normaliza acciones", () => {
    const jsonStr = JSON.stringify({
      pathname: "/jobs?tab=1",
      pageTitle: "Ofertas",
      screen: "1920x1080",
      userAgent: "Mozilla/5.0",
      theme: "dark",
      actions: [
        { type: "click", text: "  Postularme  ", time: "2026-10-30T10:00:00Z" },
        { type: "navigate", text: "Ir a /jobs" },
      ],
    });
    const res = validateFeedbackContext(jsonStr);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value?.pathname).toBe("/jobs");
      expect(res.value?.pageTitle).toBe("Ofertas");
      expect(res.value?.screen).toBe("1920x1080");
      expect(res.value?.theme).toBe("dark");
      expect(res.value?.actions).toHaveLength(2);
      expect(res.value?.actions?.[0]?.text).toBe("Postularme");
    }
  });

  it("rechaza contexto mayor a 4096 bytes", () => {
    const gigante = {
      pathname: "/hoy",
      actions: [{ type: "click", text: "x".repeat(60), time: "2026-10-30T10:00:00Z" }],
      extra: "y".repeat(FEEDBACK_CONTEXT_MAX_BYTES),
    };
    const res = validateFeedbackContext(gigante);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe("too_large");
    }
  });

  it("rechaza si contiene más de 10 acciones", () => {
    const muchas = {
      actions: Array.from({ length: 15 }, (_, i) => ({ type: "click", text: `Accion ${i}` })),
    };
    const res = validateFeedbackContext(muchas);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe("too_many_actions");
    }
  });
});
