import type { Db } from "@job-search-os/db";
import { describe, expect, it, vi } from "vitest";
import type { Logger } from "../logger";
import { drizzleRouteSource } from "./router";

/** La fuente de rutas falla cerrado ante una fila sin tarifas: sin tarifa, la llamada no se contaría. */
const row = (over: Record<string, unknown> = {}) => ({
  task: "tarea_x",
  provider: "anthropic",
  model: "modelo-a",
  fallbackModel: "modelo-b",
  temperature: 0,
  maxTokens: 1024,
  thinkingLevel: null,
  inputUsdPerMtok: 2,
  outputUsdPerMtok: 10,
  fallbackInputUsdPerMtok: 1.5,
  fallbackOutputUsdPerMtok: 9,
  ...over,
});

const dbWith = (r: Record<string, unknown>) =>
  ({
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [r] }) }) }),
  }) as unknown as Db;

const spyLogger = () => {
  const error = vi.fn();
  return { logger: { error } as unknown as Logger, error };
};

describe("drizzleRouteSource: tarifas obligatorias", () => {
  it("una fila completa se devuelve", async () => {
    const { logger, error } = spyLogger();
    const route = await drizzleRouteSource(dbWith(row()), logger).getRoute("tarea_x");
    expect(route).toMatchObject({ model: "modelo-a", fallbackModel: "modelo-b" });
    expect(error).not.toHaveBeenCalled();
  });

  it("una fila sin fallback no exige tarifas de respaldo", async () => {
    const { logger } = spyLogger();
    const r = row({
      fallbackModel: null,
      fallbackInputUsdPerMtok: null,
      fallbackOutputUsdPerMtok: null,
    });
    expect(await drizzleRouteSource(dbWith(r), logger).getRoute("tarea_x")).not.toBeNull();
  });

  it.each([
    ["sin tarifa de entrada", { inputUsdPerMtok: null }],
    ["sin tarifa de salida", { outputUsdPerMtok: null }],
    ["con respaldo y sin su tarifa de entrada", { fallbackInputUsdPerMtok: null }],
    ["con respaldo y sin su tarifa de salida", { fallbackOutputUsdPerMtok: null }],
  ])("rechaza una fila %s y deja un error claro en el log", async (_name, over) => {
    const { logger, error } = spyLogger();
    const route = await drizzleRouteSource(dbWith(row(over)), logger).getRoute("tarea_x");
    expect(route).toBeNull();
    expect(error).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(error.mock.calls[0])).toContain("tarea_x");
  });
});
