import { loadPrompt, renderPrompt } from "@job-search-os/prompts";
import {
  CV_CHAT_TURN_RESERVE_USD,
  CV_CHAT_WRITE_RESERVE_USD,
  CV_MAX_CANDIDATES,
  CV_MAX_TEXT_CHARS,
  PROFILE_AGENT_READ_RESERVE_USD,
  PROFILE_AGENT_READS_PER_MONTH,
  PROFILE_AGENT_MAX_READS_PER_DAY,
  planDef,
  profileAgentRowCostUsd,
  ROLE_KEYS,
  type SkillTaxonomyEntry,
} from "@job-search-os/pipeline";
import type { Db } from "@job-search-os/db";
import { readFileSync } from "node:fs";
import pino from "pino";
import { describe, expect, it } from "vitest";
import { CV_MONTHLY_LIMIT } from "../../cv/extract";
import { CHARS_PER_TOKEN } from "../../cv-chat/estimate";
import { createFakeLlm } from "../../llm/fake";
import type { Logger } from "../../logger";
import { readCvForAgent, type ProfileReadDeps, type ProfileReadInput } from "./read-cv";

// Todo ficticio: personas, empresas y textos inventados para el test.
const NOW = new Date("2026-11-13T12:00:00Z");
const USER = "00000000-0000-4000-8000-00000000a101";
const ENV = {
  CV_IMPORT_ENABLED: "1",
  CV_PROFILE_AGENT: "all",
  AUTH_SECRET: "secreto-de-prueba-que-no-es-real",
};
const TAXONOMY: SkillTaxonomyEntry[] = [{ slug: "sql", name: "SQL", aliases: [] }];
const CV_TEXT =
  "Analista de datos en Cooperativa Ficticia Sur desde 2019. Uso SQL todos los días para armar tableros. ".repeat(
    5,
  );

/** Una base que falla al tocarla: demuestra que el paso no llegó a la reserva ni al modelo. */
const untouchedDb = new Proxy(
  {},
  {
    get() {
      throw new Error("la base no se tendría que tocar");
    },
  },
) as unknown as Db;

const silent: Logger = pino({ level: "silent" });

function setup(over: Partial<ProfileReadDeps> = {}) {
  const llm = createFakeLlm({});
  const deps: ProfileReadDeps = {
    db: untouchedDb,
    llm,
    logger: silent,
    now: () => NOW,
    env: ENV,
    newFlowId: () => "0123456789ab",
    ...over,
  };
  return { deps, llm };
}

const input = (over: Partial<ProfileReadInput> = {}): ProfileReadInput => ({
  userId: USER,
  email: "persona@example.com",
  text: CV_TEXT,
  roles: [],
  taxonomy: TAXONOMY,
  plan: "free",
  ...over,
});

describe("readCvForAgent: lo que falla antes de reservar no toca la base ni el modelo", () => {
  it("flag apagado, sin CV_IMPORT_ENABLED o modo testers sin ser tester", async () => {
    for (const env of [
      {},
      { ...ENV, CV_PROFILE_AGENT: "off" },
      { ...ENV, CV_IMPORT_ENABLED: "0" },
      { ...ENV, CV_PROFILE_AGENT: "testers" },
    ]) {
      const { deps, llm } = setup({ env });
      expect(await readCvForAgent(input(), deps)).toEqual({
        ok: false,
        error: { code: "disabled" },
      });
      expect(llm.calls).toHaveLength(0);
    }
  });

  it("sin AUTH_SECRET no se emite ticket: falla cerrado y no gasta", async () => {
    const { AUTH_SECRET: _omit, ...env } = ENV;
    void _omit;
    const { deps, llm } = setup({ env });
    expect(await readCvForAgent(input(), deps)).toEqual({
      ok: false,
      error: { code: "ticket_unavailable" },
    });
    expect(llm.calls).toHaveLength(0);
  });

  it("texto corto o largo: el servidor no se cree al navegador", async () => {
    const { deps, llm } = setup();
    expect(await readCvForAgent(input({ text: "muy corto" }), deps)).toEqual({
      ok: false,
      error: { code: "text_too_short" },
    });
    expect(await readCvForAgent(input({ text: "palabra ".repeat(5000) }), deps)).toEqual({
      ok: false,
      error: { code: "text_too_long" },
    });
    expect(llm.calls).toHaveLength(0);
  });

  it("si la reserva falla (base caída), falla cerrado sin llamar al modelo", async () => {
    const { deps, llm } = setup();
    // `untouchedDb` lanza al primer acceso: el adaptador lo traduce a usage_unavailable
    expect(await readCvForAgent(input(), deps)).toEqual({
      ok: false,
      error: { code: "usage_unavailable" },
    });
    expect(llm.calls).toHaveLength(0);
  });
});

describe("cupo y reserva: constantes coherentes", () => {
  it("el cupo del adaptador, el del plan y el del contrato son los mismos: 3 gratis y 10 pago", () => {
    expect(CV_MONTHLY_LIMIT).toEqual(PROFILE_AGENT_READS_PER_MONTH);
    expect(planDef("gratis").limits.cvReadsPerMonth).toBe(PROFILE_AGENT_READS_PER_MONTH.free);
    expect(planDef("lista").limits.cvReadsPerMonth).toBe(PROFILE_AGENT_READS_PER_MONTH.paid);
    expect(PROFILE_AGENT_MAX_READS_PER_DAY).toBeGreaterThanOrEqual(1);
  });

  it("el estimado de una llamada fallida sin costo es el del paso, nunca 0 ni negativo", () => {
    expect(profileAgentRowCostUsd(null, PROFILE_AGENT_READ_RESERVE_USD)).toBe(
      PROFILE_AGENT_READ_RESERVE_USD,
    );
    expect(profileAgentRowCostUsd(-1, CV_CHAT_TURN_RESERVE_USD)).toBe(CV_CHAT_TURN_RESERVE_USD);
    expect(profileAgentRowCostUsd(Number.NaN, CV_CHAT_WRITE_RESERVE_USD)).toBe(
      CV_CHAT_WRITE_RESERVE_USD,
    );
    expect(profileAgentRowCostUsd(0.01, 0.08)).toBe(0.01);
  });

  it("la reserva de USD 0,08 cubre el peor caso con la fila real de model_routing", () => {
    type Row = {
      task: string;
      model: string;
      fallback_model: string | null;
      max_tokens: number;
      input_usd_per_mtok: number;
      output_usd_per_mtok: number;
      fallback_input_usd_per_mtok: number | null;
      fallback_output_usd_per_mtok: number | null;
    };
    const seed = JSON.parse(
      readFileSync(new URL("../../../../db/seeds/model_routing.json", import.meta.url), "utf8"),
    ) as Row[];
    const row = seed.find((r) => r.task === "extract_cv_profile");
    expect(row, "falta la fila extract_cv_profile en el seed").toBeDefined();
    if (!row) return;

    // Prompt renderizado con el texto más largo que acepta la ruta y el máximo de candidatas
    const prompt = loadPrompt("extract_cv_profile@v1");
    expect(prompt.ok).toBe(true);
    if (!prompt.ok) return;
    const rendered = renderPrompt(prompt.value, {
      target_roles: "no especificado",
      candidate_skills: Array.from(
        { length: CV_MAX_CANDIDATES },
        (_, i) => `skill-${i} | Skill número ${i}`,
      ).join("\n"),
      today: "2026-11",
      role_keys: ROLE_KEYS.join(", "),
      cv: `<<<CV>>>\n${"x".repeat(CV_MAX_TEXT_CHARS)}\n<<<FIN CV>>>`,
    });
    expect(rendered.ok).toBe(true);
    if (!rendered.ok) return;
    const inTokens = Math.ceil(rendered.value.length / CHARS_PER_TOKEN);

    // Peor caso: el primario agota max_tokens, falla, y el respaldo también (las dos llamadas se facturan)
    const primary =
      (inTokens * row.input_usd_per_mtok + row.max_tokens * row.output_usd_per_mtok) / 1e6;
    const fallback =
      row.fallback_model === null
        ? 0
        : (inTokens * (row.fallback_input_usd_per_mtok ?? 0) +
            row.max_tokens * (row.fallback_output_usd_per_mtok ?? 0)) /
          1e6;
    expect(primary + fallback).toBeLessThanOrEqual(PROFILE_AGENT_READ_RESERVE_USD);
  });
});
