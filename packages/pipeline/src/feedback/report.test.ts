import { describe, expect, it } from "vitest";
import {
  ITEM_MESSAGE_MAX,
  ITEM_STATUSES,
  ITEM_STATUS_LABELS,
  REPORT_ITEMS_MAX,
  REPORT_STATUSES,
  REPORT_STATUS_LABELS,
  canEditReport,
  canSendReport,
  countReportAttachments,
  isItemReadyToSend,
  isItemStatus,
  isReportStatus,
  summarizeReport,
  validateReportItem,
  validateReportForSend,
} from "./report";

describe("topes y estados del informe de revisión", () => {
  it("los topes del contrato", () => {
    expect(REPORT_ITEMS_MAX).toBe(30);
    expect(ITEM_MESSAGE_MAX).toBe(50_000);
  });

  it("estados del informe y del ítem, con su texto en llano", () => {
    expect([...REPORT_STATUSES]).toEqual(["borrador", "enviado", "visto", "resuelto"]);
    expect([...ITEM_STATUSES]).toEqual(["nuevo", "visto", "resuelto"]);
    for (const s of REPORT_STATUSES) expect(REPORT_STATUS_LABELS[s].length).toBeGreaterThan(2);
    for (const s of ITEM_STATUSES) expect(ITEM_STATUS_LABELS[s].length).toBeGreaterThan(2);
  });

  it("isReportStatus e isItemStatus no aceptan nada fuera de la lista", () => {
    expect(isReportStatus("borrador")).toBe(true);
    expect(isReportStatus("nuevo")).toBe(false);
    expect(isReportStatus(null)).toBe(false);
    expect(isItemStatus("nuevo")).toBe(true);
    expect(isItemStatus("borrador")).toBe(false);
    expect(isItemStatus(3)).toBe(false);
  });

  it("solo el borrador se edita y se envía", () => {
    expect(canEditReport("borrador")).toBe(true);
    expect(canSendReport("borrador")).toBe(true);
    for (const s of ["enviado", "visto", "resuelto"] as const) {
      expect(canEditReport(s)).toBe(false);
      expect(canSendReport(s)).toBe(false);
    }
  });
});

describe("validateReportItem", () => {
  const ok = { path: "/hoy", category: "idea", message: "Algo para contar" };

  it("acepta un ítem válido y normaliza pantalla y texto", () => {
    const r = validateReportItem({
      path: "/jobs/3f2b8c1e-9a4d-4e7b-8c21-5d6e7f8a9b0c",
      category: "confuso",
      message: "  hola\r\nmundo ​ ",
    });
    expect(r).toEqual({
      ok: true,
      value: { path: "/jobs/[id]", category: "confuso", message: "hola\nmundo" },
    });
  });

  it("rechaza categoría, pantalla y mensaje inválidos, con el primer campo que falla", () => {
    expect(validateReportItem({ ...ok, category: "otra" })).toEqual({
      ok: false,
      field: "category",
    });
    expect(validateReportItem({ ...ok, path: "hoy" })).toEqual({ ok: false, field: "path" });
    expect(validateReportItem({ ...ok, path: "/a?x=1" })).toEqual({ ok: false, field: "path" });
    expect(validateReportItem({ ...ok, path: `/${"p".repeat(200)}` })).toEqual({
      ok: false,
      field: "path",
    });
    expect(validateReportItem({ ...ok, message: 5 })).toEqual({ ok: false, field: "message" });
  });

  it("el mensaje llega hasta 50.000 caracteres y no más", () => {
    expect(validateReportItem({ ...ok, message: "a".repeat(ITEM_MESSAGE_MAX) }).ok).toBe(true);
    expect(validateReportItem({ ...ok, message: "a".repeat(ITEM_MESSAGE_MAX + 1) })).toEqual({
      ok: false,
      field: "message",
    });
  });

  it("un ítem sin texto es válido como borrador (puede tener solo adjuntos)", () => {
    expect(validateReportItem({ ...ok, message: "   " })).toEqual({
      ok: true,
      value: { path: "/hoy", category: "idea", message: "" },
    });
  });

  it("no devuelve el contenido en el error", () => {
    const r = validateReportItem({ ...ok, message: 12345 });
    expect(JSON.stringify(r)).not.toContain("12345");
  });
});

describe("isItemReadyToSend", () => {
  it("hace falta texto o al menos un adjunto", () => {
    expect(isItemReadyToSend({ message: "", attachments: 0 })).toBe(false);
    expect(isItemReadyToSend({ message: "   ", attachments: 0 })).toBe(false);
    expect(isItemReadyToSend({ message: "Algo", attachments: 0 })).toBe(true);
    expect(isItemReadyToSend({ message: "", attachments: 1 })).toBe(true);
  });
});

describe("validateReportForSend", () => {
  const item = (message: string, attachments = 0) => ({ message, attachments });

  it("un informe sin ítems no se envía", () => {
    expect(validateReportForSend([])).toEqual({ ok: false, reason: "empty" });
  });

  it("más de 30 ítems no se envía", () => {
    const many = Array.from({ length: REPORT_ITEMS_MAX + 1 }, () => item("x"));
    expect(validateReportForSend(many)).toEqual({ ok: false, reason: "too_many" });
    expect(validateReportForSend(many.slice(0, REPORT_ITEMS_MAX))).toEqual({ ok: true });
  });

  it("dice cuál es el primer ítem vacío (empezando en 1)", () => {
    expect(validateReportForSend([item("a"), item(""), item("", 2), item("   ")])).toEqual({
      ok: false,
      reason: "item_empty",
      position: 2,
    });
  });
});

describe("summarizeReport (resumen de la confirmación)", () => {
  it("plural", () => {
    expect(summarizeReport({ items: 12, screenshots: 18, documents: 2 })).toBe(
      "12 ítems, 18 capturas, 2 documentos",
    );
  });

  it("singular", () => {
    expect(summarizeReport({ items: 1, screenshots: 1, documents: 1 })).toBe(
      "1 ítem, 1 captura, 1 documento",
    );
  });

  it("cero va en plural y no se omite", () => {
    expect(summarizeReport({ items: 3, screenshots: 0, documents: 0 })).toBe(
      "3 ítems, 0 capturas, 0 documentos",
    );
  });
});

describe("countReportAttachments", () => {
  it("las imágenes son capturas; PDF y DOCX son documentos; los borrados no cuentan", () => {
    expect(
      countReportAttachments([
        { kind: "image" },
        { kind: "image" },
        { kind: "pdf" },
        { kind: "docx" },
        { kind: "image", deleted: true },
        { kind: "otra" },
      ]),
    ).toEqual({ screenshots: 2, documents: 2 });
  });
});
