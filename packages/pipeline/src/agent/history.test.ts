import { describe, expect, it } from "vitest";
import { summarizeHistory, validateHistory, type AgentMessage } from "./history";

const conv = (n: number): AgentMessage[] =>
  Array.from({ length: n }, (_, i) => ({
    role: i % 2 === 0 ? "user" : "assistant",
    text: `${i % 2 === 0 ? "pregunta" : "respuesta"} número ${i} ${"x".repeat(200)}`,
  }));

describe("validateHistory", () => {
  it("acepta un historial que alterna y termina con la persona", () => {
    expect(validateHistory([{ role: "user", text: "hola" }]).ok).toBe(true);
    expect(validateHistory(conv(19)).ok).toBe(true);
  });

  it("rechaza vacío, más de 20, sin alternar, terminado en asistente o con campos de más", () => {
    expect(validateHistory([]).ok).toBe(false);
    expect(validateHistory(conv(21)).ok).toBe(false);
    expect(validateHistory(conv(2)).ok).toBe(false);
    expect(
      validateHistory([
        { role: "user", text: "a" },
        { role: "user", text: "b" },
      ]).ok,
    ).toBe(false);
    expect(validateHistory([{ role: "assistant", text: "a" }]).ok).toBe(false);
    expect(validateHistory([{ role: "system", text: "a" }]).ok).toBe(false);
    expect(validateHistory([{ role: "user", text: "a", tool: "x" }]).ok).toBe(false);
    expect(validateHistory("hola").ok).toBe(false);
  });

  it("respeta el largo máximo de cada mensaje", () => {
    expect(validateHistory([{ role: "user", text: "a".repeat(2000) }]).ok).toBe(true);
    expect(validateHistory([{ role: "user", text: "a".repeat(2001) }]).ok).toBe(false);
    expect(validateHistory([{ role: "user", text: "" }]).ok).toBe(false);
  });
});

describe("summarizeHistory", () => {
  it("con pocos mensajes no hay resumen y los recientes van tal cual", () => {
    const messages = conv(3);
    expect(summarizeHistory(messages, [])).toEqual({ summary: null, recent: messages });
  });

  it("resume los viejos en una línea cada uno y las propuestas con su estado", () => {
    const out = summarizeHistory(conv(9), [
      { destination: "profile", fields: ["country"], status: "cargada" },
    ]);
    // 9 mensajes: los 4 últimos empezarían con el asistente, así que quedan 3
    expect(out.recent).toHaveLength(3);
    expect(out.recent[0]!.role).toBe("user");
    const lines = out.summary!.split("\n");
    expect(lines).toHaveLength(7);
    expect(lines[0]).toMatch(/^Persona: pregunta número 0 x+…$/);
    expect(lines[0]!.length).toBeLessThan(140);
    expect(lines[1]).toMatch(/^Asistente: respuesta número 1/);
    expect(lines[6]).toBe("Propuesta para profile (country): cargada");
  });

  it("es determinista", () => {
    const a = summarizeHistory(conv(15), [], { maxChars: 1500 });
    const b = summarizeHistory(conv(15), [], { maxChars: 1500 });
    expect(a).toEqual(b);
  });

  it("entra en maxChars y conserva el último mensaje de la persona", () => {
    const messages = conv(19);
    messages[18] = { role: "user", text: `inicio ${"y".repeat(3000)} final` };
    const out = summarizeHistory(messages, [], { maxChars: 1000 });
    const size = (out.summary?.length ?? 0) + out.recent.reduce((n, m) => n + m.text.length, 0);
    expect(size).toBeLessThanOrEqual(1000);
    const last = out.recent[out.recent.length - 1]!;
    expect(last.role).toBe("user");
    expect(last.text.endsWith("final")).toBe(true);
  });
});
