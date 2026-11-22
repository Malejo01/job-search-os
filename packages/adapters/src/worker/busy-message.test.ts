import pino from "pino";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { draftsCapGuard } from "../applicant/drafts";
import { createFakeLlm } from "../llm/fake";
import type { Db } from "@job-search-os/db";

/**
 * Qué texto ve la persona según por qué no se pudo reservar el gasto: demanda alta (reserva ocupada
 * o lock vencido) no es lo mismo que haber agotado el tope diario. Sin base ni modelo reales.
 */
const reserve = vi.fn();
vi.mock("../llm/spend-reserve", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  reserveLlmSpend: (...args: unknown[]) => reserve(...args),
  releaseLlmSpend: async () => true,
}));

import { BUSY_MESSAGE, evaluateJobNow, USER_CAP_MESSAGE } from "./evaluate-job";

const JOB = "11111111-1111-4111-8111-111111111111";
const OWNER = "22222222-2222-4222-8222-222222222222";

/** Base mínima: el dueño del job (limit 1) y ninguna llamada reciente (corte de circuito abierto no). */
const fakeDb = {
  select: () => {
    const chain: Record<string, unknown> = {};
    for (const m of ["from", "where", "orderBy"]) chain[m] = () => chain;
    chain.limit = async (n: number) => (n === 1 ? [{ userId: OWNER }] : []);
    return chain;
  },
} as unknown as Db;

const deps = {
  db: fakeDb,
  llm: createFakeLlm({}),
  queue: {} as never,
  logger: pino({ level: "silent" }),
};

beforeEach(() => reserve.mockReset());

describe("evaluación inmediata: mensaje según el motivo", () => {
  it.each(["concurrent", "lock_timeout"])("%s dice que hay mucha demanda", async (reason) => {
    reserve.mockResolvedValue({ ok: false, reason });
    const res = await evaluateJobNow(JOB, deps);
    expect(res).toEqual({ ran: false, reason: "busy", message: BUSY_MESSAGE });
    expect(BUSY_MESSAGE).toBe("Hay mucha demanda, probá de nuevo en un minuto");
  });

  it("el tope del usuario sigue diciendo tope diario", async () => {
    reserve.mockResolvedValue({ ok: false, reason: "user" });
    expect(await evaluateJobNow(JOB, deps)).toEqual({
      ran: false,
      reason: "user_cap",
      message: USER_CAP_MESSAGE,
    });
  });
});

describe("borradores: mensaje según el motivo", () => {
  const decide = async (_reason: string) => (await draftsCapGuard({} as Db, OWNER)()).message;

  it.each(["concurrent", "lock_timeout"])("%s dice que hay mucha demanda", async (reason) => {
    reserve.mockResolvedValue({ ok: false, reason });
    expect(await decide(reason)).toBe(BUSY_MESSAGE);
  });

  it("tope global y de usuario siguen diciendo tope diario", async () => {
    reserve.mockResolvedValue({ ok: false, reason: "global" });
    expect(await decide("global")).toMatch(/tope diario/);
    reserve.mockResolvedValue({ ok: false, reason: "user" });
    expect(await decide("user")).toMatch(/tope diario/);
  });
});
