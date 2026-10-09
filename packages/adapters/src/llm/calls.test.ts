import type { Db } from "@job-search-os/db";
import { describe, expect, it } from "vitest";
import { drizzleCallSink } from "./calls";
import type { LlmCallRecord } from "./types";

const base: LlmCallRecord = {
  userId: null,
  task: "evaluate_job",
  model: "m",
  promptVersion: "evaluate_job@v1",
  jobId: null,
  tokensIn: null,
  tokensOut: null,
  tokensReasoning: null,
  latencyMs: 1,
  costUsd: null,
  label: null,
  ok: false,
  error: null,
};

async function stored(error: string | null): Promise<unknown> {
  let seen: { error?: unknown } = {};
  const db = {
    insert: () => ({
      values: async (v: { error?: unknown }) => {
        seen = v;
      },
    }),
  } as unknown as Db;
  await drizzleCallSink(db).record({ ...base, error });
  return seen.error;
}

describe("drizzleCallSink", () => {
  it("guarda tal cual un código cerrado o null", async () => {
    expect(await stored("api_call:500")).toBe("api_call:500");
    expect(await stored(null)).toBeNull();
  });

  it("reemplaza por unknown cualquier texto que no sea un código", async () => {
    expect(await stored("Error: TEXTO-DEL-JD")).toBe("unknown");
    expect(await stored("api_call:500 TEXTO-DEL-JD")).toBe("unknown");
  });
});
