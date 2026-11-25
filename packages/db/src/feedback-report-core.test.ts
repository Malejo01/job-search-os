import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as pipeline from "@job-search-os/pipeline";
import {
  FEEDBACK_CATEGORIES,
  FEEDBACK_PATH_MAX,
  ITEM_MESSAGE_MAX,
  ITEM_STATUSES,
  REPORT_ITEMS_MAX,
  REPORT_STATUSES,
} from "@job-search-os/pipeline";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { blobFiles, feedbackAttachments, feedbackItems, feedbackReports } from "../schema";

/**
 * Los límites del informe de revisión (R29-02) viven en el pipeline (validación) y se repiten como CHECK en la
 * base. Si cambian en un lado y no en el otro, la pantalla acepta lo que la base rechaza (o al revés): este test
 * compara las constantes con los CHECK de la migración que crea las tablas.
 */
const DRIZZLE_DIR = join(__dirname, "..", "drizzle");

function migrationSql(): string {
  const file = readdirSync(DRIZZLE_DIR).find(
    (f) =>
      f.endsWith(".sql") &&
      readFileSync(join(DRIZZLE_DIR, f), "utf8").includes('CREATE TABLE "feedback_reports"'),
  );
  expect(file, "migración que crea feedback_reports").toBeDefined();
  return readFileSync(join(DRIZZLE_DIR, file!), "utf8");
}

function checkSource(sql: string, name: string): string {
  const m = new RegExp(`CONSTRAINT "${name}" CHECK \\((.*)\\)[,\\n]`).exec(sql);
  expect(m, `CHECK ${name}`).not.toBeNull();
  return m![1]!;
}

const quoted = (source: string) => [...source.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!);

describe("informe de revisión: CHECK de la base contra las constantes del pipeline", () => {
  const sql = migrationSql();

  it("estados del informe", () => {
    expect(quoted(checkSource(sql, "feedback_reports_status_check")).sort()).toEqual(
      [...REPORT_STATUSES].sort(),
    );
  });

  it("estados del ítem", () => {
    expect(quoted(checkSource(sql, "feedback_items_status_check")).sort()).toEqual(
      [...ITEM_STATUSES].sort(),
    );
  });

  it("categorías del ítem: las mismas que el comentario suelto", () => {
    expect(quoted(checkSource(sql, "feedback_items_category_check")).sort()).toEqual(
      [...FEEDBACK_CATEGORIES].sort(),
    );
  });

  it("largo del mensaje del ítem", () => {
    expect(checkSource(sql, "feedback_items_message_length")).toMatch(
      new RegExp(`between 0 and ${ITEM_MESSAGE_MAX}$`),
    );
  });

  it("largo de la pantalla", () => {
    expect(checkSource(sql, "feedback_items_path_length")).toMatch(
      new RegExp(`between 1 and ${FEEDBACK_PATH_MAX}$`),
    );
  });

  it("la posición llega a REPORT_ITEMS_MAX - 1: la base también corta en 30 ítems", () => {
    expect(checkSource(sql, "feedback_items_position_range")).toMatch(
      new RegExp(`between 0 and ${REPORT_ITEMS_MAX - 1}$`),
    );
  });

  it("tipos de adjunto: los de attachment.ts, cuando existe", () => {
    const kinds = (pipeline as Record<string, unknown>).ATTACHMENT_KINDS;
    const listed = quoted(checkSource(sql, "feedback_attachments_kind_check")).sort();
    // La lista de la base es la del contrato (`image`, `pdf`, `docx`); si attachment.ts ya existe, tienen que coincidir
    expect(listed).toEqual(["docx", "image", "pdf"]);
    if (Array.isArray(kinds)) expect([...kinds].sort()).toEqual(listed);
  });

  it("tope por archivo de 10 MB (el más grande de los topes por tipo), en adjuntos y archivos", () => {
    const tenMb = 10 * 1024 * 1024;
    expect(checkSource(sql, "feedback_attachments_bytes_range")).toMatch(
      new RegExp(`between 1 and ${tenMb}$`),
    );
    expect(checkSource(sql, "blob_files_bytes_range")).toMatch(
      new RegExp(`between 1 and ${tenMb}$`),
    );
  });

  it("el schema de Drizzle declara los CHECK esperados", () => {
    const names = (t: Parameters<typeof getTableConfig>[0]) =>
      getTableConfig(t)
        .checks.map((c) => c.name)
        .sort();
    expect(names(feedbackReports)).toEqual([
      "feedback_reports_sent_check",
      "feedback_reports_status_check",
    ]);
    expect(names(feedbackItems)).toEqual([
      "feedback_items_category_check",
      "feedback_items_message_length",
      "feedback_items_path_length",
      "feedback_items_position_range",
      "feedback_items_status_check",
    ]);
    expect(names(feedbackAttachments)).toEqual([
      "feedback_attachments_bytes_range",
      "feedback_attachments_kind_check",
      "feedback_attachments_name_length",
      "feedback_attachments_sha256_check",
      "feedback_attachments_size_check",
    ]);
    expect(names(blobFiles)).toEqual([
      "blob_files_bytes_match",
      "blob_files_bytes_range",
      "blob_files_sha256_check",
    ]);
  });
});
