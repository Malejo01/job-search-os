import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  FEEDBACK_CATEGORIES,
  FEEDBACK_MESSAGE_MAX,
  FEEDBACK_PATH_MAX,
} from "@job-search-os/pipeline";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { betaFeedback } from "../schema";

/**
 * Los límites de «Contanos qué pasó» viven en el pipeline (validación) y se repiten como CHECK en la
 * base. Si cambian en un lado y no en el otro, el formulario acepta lo que la base rechaza (o al
 * revés): este test compara las constantes con los CHECK del schema y de la migración 0045.
 */
const DRIZZLE_DIR = join(__dirname, "..", "drizzle");

function migrationSql(): string {
  const file = readdirSync(DRIZZLE_DIR).find(
    (f) =>
      f.endsWith(".sql") &&
      readFileSync(join(DRIZZLE_DIR, f), "utf8").includes('CREATE TABLE "beta_feedback"'),
  );
  expect(file, "migración que crea beta_feedback").toBeDefined();
  return readFileSync(join(DRIZZLE_DIR, file!), "utf8");
}

function checkSource(sql: string, name: string): string {
  const m = new RegExp(`CONSTRAINT "${name}" CHECK \\((.*)\\)[,\\n]`).exec(sql);
  expect(m, `CHECK ${name}`).not.toBeNull();
  return m![1]!;
}

describe("beta_feedback: CHECK de la base contra las constantes del pipeline", () => {
  const sql = migrationSql();

  it("categorías", () => {
    const listed = [...checkSource(sql, "beta_feedback_category").matchAll(/'([a-z_]+)'/g)].map(
      (m) => m[1],
    );
    expect(listed.sort()).toEqual([...FEEDBACK_CATEGORIES].sort());
  });

  it("largo del mensaje", () => {
    expect(checkSource(sql, "beta_feedback_message_length")).toMatch(
      new RegExp(`between 1 and ${FEEDBACK_MESSAGE_MAX}$`),
    );
  });

  it("largo del path", () => {
    expect(checkSource(sql, "beta_feedback_path_length")).toMatch(
      new RegExp(`<= ${FEEDBACK_PATH_MAX}$`),
    );
  });

  it("el schema de Drizzle declara los mismos tres CHECK", () => {
    const names = getTableConfig(betaFeedback)
      .checks.map((c) => c.name)
      .sort();
    expect(names).toEqual([
      "beta_feedback_category",
      "beta_feedback_message_length",
      "beta_feedback_path_length",
    ]);
  });
});
