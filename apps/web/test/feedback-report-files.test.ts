import {
  DOCUMENT_MAX_BYTES,
  FEEDBACK_UPLOAD_REQUEST_MAX_BYTES,
  IMAGE_MAX_BYTES,
} from "@job-search-os/pipeline";
import { describe, expect, it } from "vitest";
import {
  COMPRESSION_PLAN,
  IMAGE_MAX_SIDE,
  fitWithin,
  itemsToSave,
  planFileUpload,
} from "../lib/feedback-report-files";

describe("itemsToSave (un ítem por pedido, solo los que cambiaron)", () => {
  const sig = (i: { id: string; text: string }) => i.text;
  const items = [
    { id: "a", text: "uno" },
    { id: "b", text: "dos" },
    { id: "c", text: "tres" },
  ];

  it("devuelve solo los que difieren de lo guardado, en orden", () => {
    expect(itemsToSave(items, { a: "uno", b: "viejo", c: "tres" }, sig).map((i) => i.id)).toEqual([
      "b",
    ]);
  });

  it("un ítem nuevo se guarda; sin cambios da lista vacía", () => {
    expect(itemsToSave(items, { a: "uno", b: "dos" }, sig).map((i) => i.id)).toEqual(["c"]);
    expect(itemsToSave(items, { a: "uno", b: "dos", c: "tres" }, sig)).toEqual([]);
  });

  it("un ítem de 50.000 caracteres con acentos pesa menos de 1 MB: cabe en un pedido", () => {
    expect(new TextEncoder().encode("é".repeat(50_000)).length).toBeLessThan(1024 * 1024);
  });
});

const file = (name: string, type: string, size: number) => ({ name, type, size });

describe("fitWithin (lado mayor de 2.000 px)", () => {
  it("una imagen chica no se agranda", () => {
    expect(fitWithin(800, 600, IMAGE_MAX_SIDE)).toEqual({ width: 800, height: 600 });
  });

  it("una apaisada baja el ancho a 2.000 y conserva la proporción", () => {
    expect(fitWithin(4000, 2000, IMAGE_MAX_SIDE)).toEqual({ width: 2000, height: 1000 });
  });

  it("una vertical baja el alto a 2.000", () => {
    expect(fitWithin(1000, 5000, IMAGE_MAX_SIDE)).toEqual({ width: 400, height: 2000 });
  });

  it("nunca da 0 de ancho o de alto", () => {
    expect(fitWithin(10_000, 1, IMAGE_MAX_SIDE)).toEqual({ width: 2000, height: 1 });
  });

  it("dimensiones inválidas dan 1 x 1 (el servidor las rechaza igual)", () => {
    expect(fitWithin(0, 0, IMAGE_MAX_SIDE)).toEqual({ width: 1, height: 1 });
    expect(fitWithin(Number.NaN, 10, IMAGE_MAX_SIDE)).toEqual({ width: 1, height: 1 });
  });
});

describe("COMPRESSION_PLAN", () => {
  it("empieza con buena calidad y a tamaño completo, y baja calidad antes de bajar el tamaño", () => {
    expect(COMPRESSION_PLAN[0]).toEqual({ quality: 0.9, scale: 1 });
    const firstScaled = COMPRESSION_PLAN.findIndex((p) => p.scale < 1);
    expect(firstScaled).toBeGreaterThan(3);
    expect(COMPRESSION_PLAN.slice(0, firstScaled).every((p) => p.scale === 1)).toBe(true);
  });

  it("termina en un intento mínimo y todo está entre 0 y 1", () => {
    const last = COMPRESSION_PLAN[COMPRESSION_PLAN.length - 1]!;
    expect(last.quality).toBeLessThanOrEqual(0.4);
    expect(last.scale).toBeLessThanOrEqual(0.5);
    for (const p of COMPRESSION_PLAN) {
      expect(p.quality).toBeGreaterThan(0);
      expect(p.quality).toBeLessThanOrEqual(1);
      expect(p.scale).toBeGreaterThan(0);
      expect(p.scale).toBeLessThanOrEqual(1);
    }
  });
});

describe("planFileUpload (qué se hace con cada archivo antes de subir)", () => {
  it("PNG, JPEG y WebP se comprimen en el navegador", () => {
    for (const [name, type] of [
      ["a.png", "image/png"],
      ["a.jpg", "image/jpeg"],
      ["a.webp", "image/webp"],
    ] as const) {
      expect(planFileUpload(file(name, type, 100_000))).toEqual({ action: "image" });
    }
  });

  it("una imagen de más de 8 MB se rechaza antes de comprimir", () => {
    expect(planFileUpload(file("a.png", "image/png", IMAGE_MAX_BYTES))).toEqual({
      action: "image",
    });
    expect(planFileUpload(file("a.png", "image/png", IMAGE_MAX_BYTES + 1))).toEqual({
      action: "reject",
      reason: "too_large",
    });
  });

  it("PDF y DOCX suben tal cual hasta 4 MB", () => {
    expect(planFileUpload(file("a.pdf", "application/pdf", 1000))).toEqual({ action: "upload" });
    expect(
      planFileUpload(
        file(
          "a.docx",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          FEEDBACK_UPLOAD_REQUEST_MAX_BYTES,
        ),
      ),
    ).toEqual({ action: "upload" });
  });

  it("un documento de más de 4 MB se rechaza en el navegador con «Por ahora, documentos de hasta 4 MB»", () => {
    expect(
      planFileUpload(file("a.pdf", "application/pdf", FEEDBACK_UPLOAD_REQUEST_MAX_BYTES + 1)),
    ).toEqual({ action: "reject", reason: "request_too_large" });
    // Los 10 MB del modelo no se alcanzan: el pedido de Vercel corta antes
    expect(FEEDBACK_UPLOAD_REQUEST_MAX_BYTES).toBeLessThan(DOCUMENT_MAX_BYTES);
  });

  it("se decide por la extensión cuando el navegador no da el tipo (Windows con .docx)", () => {
    expect(planFileUpload(file("Informe.DOCX", "", 5000))).toEqual({ action: "upload" });
    expect(planFileUpload(file("informe.pdf", "", 5000))).toEqual({ action: "upload" });
  });

  it("SVG, HTML, GIF, ZIP y todo lo demás se rechaza", () => {
    for (const [name, type] of [
      ["a.svg", "image/svg+xml"],
      ["a.html", "text/html"],
      ["a.gif", "image/gif"],
      ["a.zip", "application/zip"],
      ["a.exe", "application/octet-stream"],
      ["sin-extension", ""],
    ] as const) {
      expect(planFileUpload(file(name, type, 1000))).toEqual({ action: "reject", reason: "type" });
    }
  });

  it("un archivo vacío se rechaza", () => {
    expect(planFileUpload(file("a.pdf", "application/pdf", 0))).toEqual({
      action: "reject",
      reason: "empty",
    });
  });

  it("un .png que en realidad se declara como PDF no engaña: el servidor igual mira los bytes", () => {
    // Acá solo se decide el camino; la validación real (magic bytes) es del servidor (attachment.ts)
    expect(planFileUpload(file("falso.png", "application/pdf", 1000))).toEqual({
      action: "upload",
    });
  });
});
