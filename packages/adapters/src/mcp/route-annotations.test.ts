import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Test sobre el código fuente de la ruta (importa "@/lib/..." y la base, no se puede cargar acá;
// mismo enfoque que route-source.test.ts). Fija que cada tool declare qué hace con los datos.
const route = readFileSync(
  new URL("../../../../apps/web/app/api/mcp/route.ts", import.meta.url),
  "utf8",
).replace(/\/\*[\s\S]*?\*\//g, "");

/** Cada tool: su nombre y el texto de su declaración hasta la siguiente. */
const tools = route
  .split("server.registerTool(")
  .slice(1)
  .map((chunk) => ({
    name: /^\s*"([a-z_]+)"/.exec(chunk)?.[1] ?? "?",
    annotations: /annotations:\s*\{([^}]*)\}/.exec(chunk)?.[1] ?? null,
  }));

const WRITERS = ["set_status", "paste_jd", "add_job", "save_answer", "save_application_answers"];
const READERS = [
  "list_pending_jd",
  "list_jobs",
  "get_job",
  "market_summary",
  "get_candidate_profile",
  "list_answers",
];

describe("anotaciones de las tools del MCP", () => {
  it("la ruta registra todas las tools esperadas", () => {
    expect(tools.map((t) => t.name).sort()).toEqual([...READERS, ...WRITERS].sort());
  });

  it.each(tools.map((t) => [t.name, t.annotations] as const))(
    "%s declara anotaciones",
    (_name, annotations) => {
      expect(annotations).not.toBeNull();
    },
  );

  it.each(READERS)("%s es de solo lectura", (name) => {
    expect(tools.find((t) => t.name === name)?.annotations).toMatch(/readOnlyHint:\s*true/);
  });

  it.each(WRITERS)("%s no se declara de solo lectura y dice si es destructiva", (name) => {
    const a = tools.find((t) => t.name === name)?.annotations ?? "";
    expect(a).toMatch(/readOnlyHint:\s*false/);
    expect(a).toMatch(/destructiveHint:\s*(true|false)/);
  });

  it.each(["set_status", "save_answer", "save_application_answers", "add_job"])(
    "%s cambia o reemplaza datos: destructiveHint true",
    (name) => {
      expect(tools.find((t) => t.name === name)?.annotations).toMatch(/destructiveHint:\s*true/);
    },
  );

  it("paste_jd solo completa lo que está vacío: no es destructiva", () => {
    expect(tools.find((t) => t.name === "paste_jd")?.annotations).toMatch(
      /destructiveHint:\s*false/,
    );
  });
});
