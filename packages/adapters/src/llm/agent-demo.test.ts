import pino from "pino";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ASSISTANT_TASK, streamAgent, type AgentEvent, type AgentStreamPart } from "./agent";
import { createDemoAgentDeps, demoAgentStreamFn, DEMO_AGENT_MODEL } from "./agent-demo";
import { memoryCallSink } from "./calls";

async function parts(content: string, extra: { lastTool?: boolean } = {}) {
  const out: AgentStreamPart[] = [];
  const messages = extra.lastTool
    ? [
        { role: "user" as const, content },
        {
          role: "assistant" as const,
          content: "",
          toolCalls: [{ id: "demo-0", name: "get_profile", input: {} }],
        },
        {
          role: "tool" as const,
          results: [{ id: "demo-0", name: "get_profile", output: "{}", isError: false }],
        },
      ]
    : [{ role: "user" as const, content }];
  for await (const p of demoAgentStreamFn({
    model: {} as never,
    system: "",
    messages,
    tools: {},
    activeTools: ["get_profile", "propose_profile"],
    maxOutputTokens: 600,
    temperature: 0,
    abortSignal: new AbortController().signal,
  })) {
    out.push(p);
  }
  return out;
}

describe("demoAgentStreamFn", () => {
  it("«me mudé a Uruguay» propone el país en ISO con la cita exacta", async () => {
    const out = await parts("Hola. Me mudé a Uruguay el mes pasado");
    expect(out).toContainEqual({
      type: "tool-call",
      toolCallId: "demo-0",
      toolName: "propose_profile",
      input: {
        changes: [
          {
            field: "country",
            value: "UY",
            source: { from: "message", quote: "Me mudé a Uruguay" },
          },
        ],
      },
    });
    expect(out.at(-1)).toMatchObject({ type: "finish" });
  });

  it("años de experiencia", async () => {
    const out = await parts("tengo 6 años de experiencia en soporte");
    expect(out).toContainEqual(
      expect.objectContaining({
        toolName: "propose_profile",
        input: {
          changes: [
            {
              field: "yearsTotal",
              value: "6",
              source: { from: "message", quote: "tengo 6 años de experiencia" },
            },
          ],
        },
      }),
    );
  });

  it("país que no está en la lista: no propone, lee el perfil", async () => {
    const out = await parts("me mudé a Atlantis");
    expect(out).toContainEqual(expect.objectContaining({ toolName: "get_profile" }));
  });

  it("sin tools activas de propuesta: no propone", async () => {
    const out: AgentStreamPart[] = [];
    for await (const p of demoAgentStreamFn({
      model: {} as never,
      system: "",
      messages: [{ role: "user", content: "me mudé a Chile" }],
      tools: {},
      activeTools: [],
      maxOutputTokens: 600,
      temperature: 0,
      abortSignal: new AbortController().signal,
    })) {
      out.push(p);
    }
    expect(out.some((p) => p.type === "tool-call")).toBe(false);
    expect(out.some((p) => p.type === "text-delta")).toBe(true);
  });

  it("con resultado de tool: texto DEMO y fin", async () => {
    const out = await parts("me mudé a Chile", { lastTool: true });
    expect(out.some((p) => p.type === "tool-call")).toBe(false);
    const text = out
      .filter((p): p is Extract<AgentStreamPart, { type: "text-delta" }> => p.type === "text-delta")
      .map((p) => p.text)
      .join("");
    expect(text.startsWith("DEMO:")).toBe(true);
  });
});

describe("createDemoAgentDeps", () => {
  it("corre un turno entero sin red, con model fake y costo 0", async () => {
    const calls = memoryCallSink();
    const deps = { ...createDemoAgentDeps({ calls }), logger: pino({ level: "silent" }) };
    const events: AgentEvent[] = [];
    const tools = {
      get_profile: {
        description: "Lee el perfil",
        inputSchema: z.object({}).strict(),
        execute: async () => ({ country: "AR" }),
      },
      propose_profile: {
        description: "Propone",
        inputSchema: z.object({ changes: z.array(z.unknown()) }),
        execute: async () => ({ propuesta: "lista" }),
      },
    };
    for await (const e of streamAgent(
      ASSISTANT_TASK,
      {
        system: "",
        messages: [{ role: "user", content: "Me mudé a Uruguay" }],
        tools,
        isProposal: (n) => n.startsWith("propose_"),
        spentUsd: 0,
        promptVersion: "assistant_chat@demo",
      },
      { userId: "00000000-0000-4000-8000-000000000002", label: "conv:demo01" },
      deps,
    )) {
      events.push(e);
    }
    expect(events).toContainEqual(
      expect.objectContaining({ type: "tool", name: "propose_profile", isError: false }),
    );
    expect(events.at(-1)).toEqual({ type: "done", steps: 2, costUsd: 0 });
    expect(calls.calls.every((c) => c.model === DEMO_AGENT_MODEL && c.costUsd === 0)).toBe(true);
  });
});
