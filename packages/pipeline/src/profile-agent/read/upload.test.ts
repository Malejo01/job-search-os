import { describe, expect, it } from "vitest";
import { CV_MAX_FILE_BYTES, CV_MAX_TEXT_CHARS, CV_MIN_TEXT_CHARS } from "../../cv/limits";
import {
  PROFILE_READ_ERRORS,
  PROFILE_READ_INPUT_MESSAGES,
  checkProfileReadText,
  classifyCvUpload,
  profileReadErrorFor,
  profileReadFallbacks,
  profileReadInputNotice,
  profileReadRequestSchema,
} from "./upload";

const MB = 1024 * 1024;

describe("classifyCvUpload", () => {
  it("acepta PDF y DOCX hasta 5 MB, sin importar mayúsculas", () => {
    expect(classifyCvUpload({ name: "Mi CV.PDF", size: 1000 })).toEqual({ ok: true, value: "pdf" });
    expect(classifyCvUpload({ name: "cv.docx", size: CV_MAX_FILE_BYTES })).toEqual({
      ok: true,
      value: "docx",
    });
    expect(CV_MAX_FILE_BYTES).toBe(5 * MB);
  });

  it("rechaza lo vacío, lo que pasa de 5 MB, .doc viejo y otros tipos", () => {
    expect(classifyCvUpload({ name: "a.pdf", size: 0 })).toEqual({ ok: false, error: "empty" });
    expect(classifyCvUpload({ name: "a.pdf", size: CV_MAX_FILE_BYTES + 1 })).toEqual({
      ok: false,
      error: "too_large",
    });
    expect(classifyCvUpload({ name: "a.doc", size: 10 })).toEqual({
      ok: false,
      error: "legacy_doc",
    });
    for (const name of ["foto.png", "cv.pdf.exe", "cv", "cv.txt"]) {
      expect(classifyCvUpload({ name, size: 10 }), name).toEqual({
        ok: false,
        error: "unsupported",
      });
    }
    expect(classifyCvUpload({ name: "a.pdf", size: Number.NaN })).toEqual({
      ok: false,
      error: "empty",
    });
  });
});

describe("checkProfileReadText", () => {
  const long = "Experiencia en Empresa Ficticia como analista de datos. ".repeat(10);

  it("normaliza el texto igual que el servidor", () => {
    const invisible = String.fromCharCode(0x200b); // espacio de ancho cero
    const r = checkProfileReadText(`${long}${invisible}\r\n\r\n\r\n\r\nFin`, "paste");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).not.toContain(invisible);
      expect(r.value).not.toMatch(/\n{3,}/);
    }
  });

  it("un archivo con poco texto (escaneado) es 'unreadable'; pegado, 'text_too_short'", () => {
    const few = "x".repeat(CV_MIN_TEXT_CHARS - 1);
    expect(checkProfileReadText(few, "file")).toEqual({ ok: false, error: "unreadable" });
    expect(checkProfileReadText(few, "paste")).toEqual({ ok: false, error: "text_too_short" });
    expect(checkProfileReadText("", "file")).toEqual({ ok: false, error: "unreadable" });
  });

  it("demasiado largo", () => {
    const r = checkProfileReadText("palabra ".repeat(CV_MAX_TEXT_CHARS), "paste");
    expect(r).toEqual({ ok: false, error: "text_too_long" });
  });
});

describe("avisos", () => {
  it("el PDF dice «Pegá el texto de tu CV» y no ofrece la charla (hay camino: pegar)", () => {
    const n = profileReadInputNotice("pdf_paste", "app");
    expect(n.message).toMatch(/^Pegá el texto de tu CV/);
    expect(n.fallbacks).toEqual([]);
  });

  it("un archivo escaneado ofrece seguir con la charla desde cero y completarlo a mano", () => {
    const n = profileReadInputNotice("unreadable", "app");
    expect(n.message).toMatch(/escaneado/);
    expect(n.fallbacks.map((f) => f.href)).toEqual(["/cv/armar", "/settings/historial"]);
    expect(n.fallbacks[0]!.label).toBe("Seguir con la charla desde cero");
  });

  it("durante el onboarding no hay link a (app): solo volver al formulario", () => {
    expect(profileReadFallbacks("onboarding")).toEqual([
      { label: "Prefiero completarlo a mano", href: "/onboarding" },
    ]);
    for (const p of Object.keys(
      PROFILE_READ_INPUT_MESSAGES,
    ) as (keyof typeof PROFILE_READ_INPUT_MESSAGES)[]) {
      for (const f of profileReadInputNotice(p, "onboarding").fallbacks) {
        expect(f.href.startsWith("/cv"), p).toBe(false);
        expect(f.href.startsWith("/settings"), p).toBe(false);
      }
    }
  });

  it("los mensajes son fijos: no llevan links ni números inventados de cupo", () => {
    for (const m of Object.values(PROFILE_READ_INPUT_MESSAGES)) {
      expect(m).not.toMatch(/https?:|www\./);
    }
    for (const e of Object.values(PROFILE_READ_ERRORS)) {
      expect(e.message).not.toMatch(/https?:|www\./);
    }
  });
});

describe("pedido y errores del endpoint", () => {
  it("el pedido solo lleva `text`: ni archivo ni ticket ni claves de más", () => {
    expect(profileReadRequestSchema.safeParse({ text: "hola" }).success).toBe(true);
    expect(profileReadRequestSchema.safeParse({ text: "hola", ticket: "x" }).success).toBe(false);
    expect(profileReadRequestSchema.safeParse({ text: "hola", file: "AAAA" }).success).toBe(false);
    expect(profileReadRequestSchema.safeParse({}).success).toBe(false);
    expect(profileReadRequestSchema.safeParse({ text: "x".repeat(100_001) }).success).toBe(false);
  });

  it("los errores del adaptador se traducen; un código desconocido es 'server'", () => {
    expect(profileReadErrorFor("disabled")).toBe("not_found");
    expect(profileReadErrorFor("injection_detected")).toBe("injection");
    for (const c of ["timeout", "aborted", "llm_failed", "no_route"]) {
      expect(profileReadErrorFor(c), c).toBe("llm_unavailable");
    }
    for (const c of ["output_invalid", "sensitive_output", "redaction_failed"]) {
      expect(profileReadErrorFor(c), c).toBe("unreadable_result");
    }
    expect(profileReadErrorFor("algo_nuevo")).toBe("server");
  });

  it("una lectura que falla promete que no se descontó del cupo (#162)", () => {
    expect(PROFILE_READ_ERRORS.llm_unavailable.message).toMatch(/no se descontó/i);
    expect(PROFILE_READ_ERRORS.unreadable_result.message).toMatch(/no se descontó/i);
  });

  it("estados HTTP: sesión 401, flag apagado 404, tope 429 va aparte", () => {
    expect(PROFILE_READ_ERRORS.unauthorized.status).toBe(401);
    expect(PROFILE_READ_ERRORS.not_found.status).toBe(404);
    expect("capped" in PROFILE_READ_ERRORS).toBe(false);
  });
});
