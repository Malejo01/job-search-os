import { describe, expect, it } from "vitest";
import { CV_RESERVE_TTL_MS } from "../cv-chat/reserve";
import { DEFAULT_CALL_TIMEOUT_MS } from "./client";
import { FAILED_CALL_ESTIMATE_USD } from "./spend";
import { LLM_RESERVE_TTL_MS } from "./spend-reserve";

/** Un turno puede usar el modelo primario y el de respaldo, uno después del otro. */
const LONGEST_CALL_MS = 2 * DEFAULT_CALL_TIMEOUT_MS;

describe("vencimiento de las reservas de gasto", () => {
  it("la reserva del chat de CV dura más que el primario y el respaldo juntos", () => {
    expect(CV_RESERVE_TTL_MS).toBeGreaterThan(LONGEST_CALL_MS);
  });

  it("la reserva de evaluaciones y borradores dura más que el primario y el respaldo juntos", () => {
    expect(LLM_RESERVE_TTL_MS).toBeGreaterThan(LONGEST_CALL_MS);
  });
});

describe("estimado de una llamada fallida", () => {
  it("cubre una llamada con el tope de entrada, no solo una evaluación típica", () => {
    expect(FAILED_CALL_ESTIMATE_USD).toBeGreaterThanOrEqual(0.04);
  });
});
