import { describe, expect, it } from "vitest";
import { anthropicRequestFor } from "./fallback-request.util";

/**
 * El respaldo hereda el `thinking_level` de la fila (`minimal`). Con un fetch falso (sin red) se mira qué
 * pedido arma el SDK para cada modelo de respaldo: no tiene que mandar `thinking: disabled` ni un
 * presupuesto de thinking que el modelo rechace.
 */
describe("respaldo de Anthropic con thinking_level = minimal", () => {
  it("claude-sonnet-5-5 (cv_write): thinking adaptativo con esfuerzo bajo, nunca `disabled`", async () => {
    const body = await anthropicRequestFor("claude-sonnet-5-5", 3000);
    expect(body.thinking?.type).not.toBe("disabled");
    expect(body.thinking).toBeDefined();
    expect(body.output_config?.effort).toBe("low");
  });

  it("claude-haiku-4-5 (cv_interview): presupuesto de thinking válido y max_tokens por encima", async () => {
    const body = await anthropicRequestFor("claude-haiku-4-5", 1024);
    expect(body.thinking?.type).toBe("enabled");
    expect(body.thinking?.budget_tokens).toBeGreaterThanOrEqual(1024);
    expect(body.max_tokens).toBeGreaterThan(body.thinking!.budget_tokens!);
  });
});
