import { describe, expect, it } from "vitest";
import {
  activeToolsFor,
  AGENT_PROPOSE_TOOLS,
  AGENT_READ_TOOLS,
  isAgentTool,
  isProposeTool,
  proposeInputSchemas,
  proposeToolDestination,
  readInputSchemas,
} from "./tools";

const base = { turn: 0, step: 0, proposalsThisTurn: 0, screen: null };

describe("activeToolsFor", () => {
  it("al empezar el turno ofrece lectura y propuesta, en orden estable", () => {
    expect(activeToolsFor(base)).toEqual([...AGENT_READ_TOOLS, ...AGENT_PROPOSE_TOOLS]);
  });

  it("el último paso del turno (el sexto) no tiene tools: responde en texto", () => {
    expect(activeToolsFor({ ...base, step: 4 }).length).toBeGreaterThan(0);
    expect(activeToolsFor({ ...base, step: 5 })).toEqual([]);
    expect(activeToolsFor({ ...base, step: 9 })).toEqual([]);
  });

  it("después de una propuesta en el turno, solo lectura", () => {
    const tools = activeToolsFor({ ...base, proposalsThisTurn: 1 });
    expect(tools).toEqual([...AGENT_READ_TOOLS]);
    expect(tools.some(isProposeTool)).toBe(false);
  });

  it("pasado el tope de turnos no hay tools", () => {
    expect(activeToolsFor({ ...base, turn: 10 })).toEqual([]);
  });
});

describe("catálogo", () => {
  it("ninguna tool de lectura se llama propose_ y cada propuesta tiene destino", () => {
    for (const t of AGENT_READ_TOOLS) expect(isProposeTool(t)).toBe(false);
    expect(AGENT_PROPOSE_TOOLS.map(proposeToolDestination)).toEqual([
      "profile",
      "skill_levels",
      "criteria",
      "target_roles",
    ]);
    expect(isAgentTool("set_status")).toBe(false);
    expect(isAgentTool("save_answer")).toBe(false);
    expect(isAgentTool("get_job")).toBe(true);
  });

  it("los esquemas son estrictos: un userId o un campo de más no pasa", () => {
    expect(readInputSchemas.get_profile.safeParse({ userId: "x" }).success).toBe(false);
    expect(
      readInputSchemas.get_job.safeParse({ id: "0b9c6a1e-3f2d-4c5b-8a7e-1d2c3b4a5f60" }).success,
    ).toBe(true);
    expect(readInputSchemas.list_jobs.parse({})).toEqual({ limit: 5 });
    expect(readInputSchemas.list_jobs.safeParse({ limit: 11 }).success).toBe(false);
    expect(
      proposeInputSchemas.propose_target_roles.safeParse({
        roles: ["frontend"],
        source: { from: "message", quote: "frontend" },
        apply: true,
      }).success,
    ).toBe(false);
  });

  it("toda propuesta exige fundamento", () => {
    expect(
      proposeInputSchemas.propose_profile.safeParse({
        changes: [{ field: "country", value: "UY" }],
      }).success,
    ).toBe(false);
    expect(
      proposeInputSchemas.propose_profile.safeParse({
        changes: [{ field: "country", value: "UY", source: { from: "jd", quote: "Uruguay" } }],
      }).success,
    ).toBe(false);
  });
});
