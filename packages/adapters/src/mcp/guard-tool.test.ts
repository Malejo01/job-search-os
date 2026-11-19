import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { guardMcpTool } from "./errors";

const SENSITIVE = "select * from users where email = 'ana@example.com'";

const TOOLS = [
  "list_pending_jd",
  "list_jobs",
  "get_job",
  "set_status",
  "paste_jd",
  "add_job",
  "market_summary",
  "get_candidate_profile",
  "list_answers",
  "save_answer",
  "save_application_answers",
];

const USER = "00000000-0000-4000-8000-000000000001";
const textOf = (r: unknown) => (r as { content: { text: string }[] }).content[0]!.text;

describe("guardMcpTool: cualquier excepción de una tool llega como error fijo", () => {
  it.each(TOOLS)("%s: la excepción no se muestra", async (tool) => {
    const log = vi.fn();
    const run = guardMcpTool(
      tool,
      async () => USER,
      async () => {
        throw new Error(SENSITIVE);
      },
      log,
    );
    const out = await run({}, {});
    expect(textOf(out)).toContain("error_interno");
    expect(JSON.stringify(out)).not.toContain("ana@example.com");
    expect(JSON.stringify(out)).not.toContain("select");
    expect((out as { isError: boolean }).isError).toBe(true);
  });

  it("también cuando falla la resolución de la persona", async () => {
    const log = vi.fn();
    const run = guardMcpTool(
      "get_job",
      async () => {
        throw new Error(SENSITIVE);
      },
      async () => {
        throw new Error(SENSITIVE);
      },
      log,
    );
    expect(textOf(await run({}, {}))).not.toContain("ana@example.com");
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]![0]).toBe("desconocido");
  });

  it("el log lleva persona y nombre de la tool, sin parámetros ni message", async () => {
    const log = vi.fn();
    const run = guardMcpTool(
      "list_jobs",
      async () => USER,
      async () => {
        throw new Error(SENSITIVE);
      },
      log,
    );
    await run({ query: "dato-del-request" }, {});
    expect(log).toHaveBeenCalledTimes(1);
    const [userId, tool, detail] = log.mock.calls[0]!;
    expect(userId).toBe(USER);
    expect(tool).toBe("list_jobs");
    expect(JSON.stringify(log.mock.calls[0])).not.toContain("ana@example.com");
    expect(JSON.stringify(log.mock.calls[0])).not.toContain("dato-del-request");
    expect(detail).toBeDefined();
  });

  it("lo que sale bien pasa tal cual y los errores esperados siguen con su código", async () => {
    const ok = guardMcpTool(
      "get_job",
      async () => USER,
      async () => ({ content: [] }),
      vi.fn(),
    );
    expect(await ok({}, {})).toEqual({ content: [] });
  });
});

describe("la ruta registra todas las tools por el guardia", () => {
  const route = readFileSync(
    new URL("../../../../apps/web/app/api/mcp/route.ts", import.meta.url),
    "utf8",
  ).replace(/\/\*[\s\S]*?\*\//g, "");

  it("el servidor sin guardia solo se usa dentro del envoltorio", () => {
    expect(route).toContain("guardMcpTool(");
    expect(route.match(/rawServer\.registerTool\(/g)).toHaveLength(1);
  });
});
