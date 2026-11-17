import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createDemoLlm, type LlmClient } from "@job-search-os/adapters";
import { describe, expect, it } from "vitest";
import { loadCvCoachGolden, PUBLIC_DIR } from "./golden";
import { createCoachBudget, unlimitedCoachBudget } from "./guard";
import { recordingLlm, replayLlm, type RecordedTranscript } from "./recorded";
import { buildCoachReport } from "./report";
import { applyCards, labeledLlm, runConversation } from "./run";
import { simulatedLlm } from "./simulated";

process.env.LOG_LEVEL = "silent";
const golden = loadCvCoachGolden();
const byId = (id: string) => golden.find((g) => g.fixture.id === id)!;
const transcript = (id: string) =>
  JSON.parse(
    readFileSync(join(PUBLIC_DIR, "grabadas", `${id}.json`), "utf8"),
  ) as RecordedTranscript;

describe("charla completa con el modelo de demo (sin red, sin gasto)", () => {
  it("las 11 fixtures recorren diagnóstico, charla y redacción sin errores", async () => {
    for (const g of golden) {
      const o = await runConversation(g, {
        llm: createDemoLlm(),
        budget: unlimitedCoachBudget(),
        stage: "charla",
      });
      expect(o.errors, g.fixture.id).toEqual([]);
      expect(o.record.issues.length, g.fixture.id).toBeGreaterThan(0);
      expect(o.record.finalCv.length, g.fixture.id).toBeGreaterThan(0);
      expect(o.metrics.inventions, g.fixture.id).toBe(0);
    }
  });

  it("solo diagnóstico: una llamada por CV y sin charla", async () => {
    const o = await runConversation(byId("abogacia"), {
      llm: createDemoLlm(),
      budget: unlimitedCoachBudget(),
      stage: "diagnostico",
    });
    expect(o.record.calls).toBe(1);
    expect(o.record.questions).toEqual([]);
    expect(o.record.closeReason).toBe("solo_diagnostico");
  });
});

describe("transcripciones grabadas: métricas sin modelo", () => {
  it.each(["con-experiencia", "sin-experiencia", "fullstack-17-11"])(
    "%s se vuelve a medir igual y consume toda la transcripción",
    async (id) => {
      const t = transcript(id);
      expect(t.origen).toBe("simulada");
      const llm = replayLlm(t);
      const o = await runConversation(byId(id), {
        llm,
        budget: unlimitedCoachBudget(),
        stage: "charla",
      });
      expect(o.errors).toEqual([]);
      expect(llm.remaining()).toBe(0);
      expect(o.metrics.inventions).toBe(0);
      expect(o.metrics.lostFacts).toBe(0);
      expect(o.metrics.diagnosisRecall).toBe(1);
      expect(o.metrics.diagnosisPrecision).toBe(1);
      // repetible: dos veces la misma transcripción, las mismas métricas
      const again = await runConversation(byId(id), {
        llm: replayLlm(t),
        budget: unlimitedCoachBudget(),
        stage: "charla",
      });
      expect({ ...again.metrics, ms: 0 }).toEqual({ ...o.metrics, ms: 0 });
    },
  );

  it("con-experiencia: una repregunta por una skill ya mostrada por alias cuenta como repetida", async () => {
    const o = await runConversation(byId("con-experiencia"), {
      llm: replayLlm(transcript("con-experiencia")),
      budget: unlimitedCoachBudget(),
      stage: "charla",
    });
    expect(o.metrics.repeatedQuestions).toBe(1);
    expect(o.record.questions.find((q) => q.alreadyComplete)?.type).toBe("brecha_con_puesto");
  });

  it("una transcripción que no corresponde falla cerrado (no se mide con salidas cruzadas)", async () => {
    const wrong = transcript("sin-experiencia");
    const o = await runConversation(byId("con-experiencia"), {
      llm: replayLlm({ ...wrong, calls: wrong.calls.slice(0, 1) }),
      budget: unlimitedCoachBudget(),
      stage: "charla",
    });
    expect(o.errors.length).toBeGreaterThan(0);
  });

  it("grabar y volver a correr da lo mismo que el modelo grabado", async () => {
    const g = byId("marketing");
    const rec = recordingLlm(simulatedLlm(g.fixture));
    const live = await runConversation(g, {
      llm: rec.llm,
      budget: unlimitedCoachBudget(),
      stage: "charla",
    });
    const t: RecordedTranscript = {
      fixtureId: g.fixture.id,
      origen: "simulada",
      nota: "",
      calls: rec.calls,
    };
    const replayed = await runConversation(g, {
      llm: replayLlm(t),
      budget: unlimitedCoachBudget(),
      stage: "charla",
    });
    expect({ ...replayed.metrics, ms: 0 }).toEqual({ ...live.metrics, ms: 0 });
  });
});

describe("guard de costo dentro de la corrida", () => {
  it("corta antes de pasar el tope y la charla igual termina con su CV (la redacción quedó reservada)", async () => {
    const g = byId("fullstack-17-11");
    const tasks: string[] = [];
    const inner = simulatedLlm(g.fixture);
    const pricey: LlmClient = {
      async generateStructured(task, schema, vars, ctx) {
        tasks.push(task);
        const r = await inner.generateStructured(task, schema, vars, ctx);
        return r.ok ? { ok: true, value: { ...r.value, costUsd: 0.03 } } : r;
      },
    };
    const budget = createCoachBudget(0.2);
    const o = await runConversation(g, { llm: pricey, budget, stage: "charla" });
    expect(budget.spent()).toBeLessThanOrEqual(0.2);
    expect(budget.cut()).toBe(true);
    expect(o.record.closeReason).toBe("tope_usd");
    expect(tasks.at(-1)).toBe("cv_write");
    expect(o.record.finalWritten.length).toBeGreaterThan(0);
  });
});

describe("registro y reporte", () => {
  it("cada llamada va a llm_calls con label r12, task eval:<versión> y sin persona", async () => {
    const seen: Record<string, unknown>[] = [];
    const spy: LlmClient = {
      async generateStructured(task, schema, vars, ctx = {}) {
        seen.push({ task, ...ctx });
        return createDemoLlm().generateStructured(task, schema, vars, ctx);
      },
    };
    await runConversation(byId("abogacia"), {
      llm: labeledLlm(spy, "r12"),
      budget: unlimitedCoachBudget(),
      stage: "charla",
    });
    expect(seen.length).toBeGreaterThan(0);
    for (const c of seen) {
      expect(c.label).toBe("r12");
      expect(c.userId).toBeUndefined();
      expect(String(c.recordTask)).toMatch(/^eval:/);
    }
    expect(seen.find((c) => c.task === "cv_review")?.recordTask).toBe("eval:cv_review@v1");
  });

  it("el reporte guarda solo métricas: ni el CV, ni las respuestas, ni las preguntas; las privadas sin su id", async () => {
    const g = byId("con-experiencia");
    const o = await runConversation(g, {
      llm: replayLlm(transcript(g.fixture.id)),
      budget: unlimitedCoachBudget(),
      stage: "charla",
    });
    const report = buildCoachReport({
      mode: "grabada",
      stage: "charla",
      runs: 1,
      maxUsd: 0.6,
      cut: false,
      outcomes: [
        { source: "public", run: 0, outcome: o },
        { source: "private", run: 0, outcome: o },
      ],
    });
    const json = JSON.stringify(report);
    expect(json).not.toContain("Empresa C");
    expect(json).not.toContain("8 a 5 días");
    expect(json).not.toContain("¿");
    expect(report.rows.map((r) => r.fixture)).toEqual(["con-experiencia", "privada-1"]);
  });
});

describe("tarjetas aceptadas", () => {
  it("cada tipo de tarjeta cambia el ítem como lo haría el cierre", () => {
    const items = byId("fullstack-17-11").fixture.lectura.items;
    const p3 = items.find((i) => i.clave === "proy-3")!;
    const out = applyCards(items, [
      {
        kind: "dates",
        key: "cc:1",
        historyId: p3.id,
        startMonth: "2025-07",
        endMonth: "2025-09",
        isCurrent: false,
      },
      { kind: "stack", key: "cc:2", historyId: p3.id, stack: ["TypeScript", "Node.js"] },
      { kind: "link", key: "cc:3", historyId: p3.id, link: "https://ejemplo.com/proyecto-3" },
      { kind: "note", key: "cc:4", historyId: null, text: "Algo sin ubicar.", about: "logro" },
    ]);
    const after = out.find((i) => i.id === p3.id)!;
    expect(after).toMatchObject({
      startMonth: "2025-07",
      endMonth: "2025-09",
      link: "https://ejemplo.com/proyecto-3",
    });
    expect(after.bullets).toContain("Stack: TypeScript, Node.js");
    expect(out.flatMap((i) => i.bullets)).not.toContain("Algo sin ubicar.");
    expect(items.find((i) => i.id === p3.id)!.startMonth).toBeNull();
  });
});
