import { describe, expect, it } from "vitest";
import { betaHealth, RESEND_DAILY_CAP, type BetaHealthInput } from "./beta-health";

const now = new Date("2026-11-27T12:00:00Z");
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);

const calm: BetaHealthInput = {
  now,
  queue: { pending: 4, oldestPendingAt: hoursAgo(1) },
  llm: { spent24hUsd: 0.6, capUsd: 4 },
  emails: { sentToday: 6, receivedToday: 40 },
  ingestErrors24h: { inbound: 0, pool: 1 },
  activeToday: 9,
  feedback24h: 0,
};

const level = (input: BetaHealthInput, key: string) =>
  betaHealth(input).rows.find((r) => r.key === key)!.level;

describe("betaHealth (C8-11): semáforo de la mañana", () => {
  it("un día tranquilo da todo en verde", () => {
    const h = betaHealth(calm);
    expect(h.overall).toBe("verde");
    expect(h.rows.map((r) => r.key)).toEqual([
      "cola",
      "ia",
      "emails",
      "ingesta",
      "activas",
      "feedback",
    ]);
  });

  it("cola: amarilla con una oferta esperando más de un ciclo del cron (6 h), roja con más de 24 h", () => {
    expect(level({ ...calm, queue: { pending: 10, oldestPendingAt: hoursAgo(7) } }, "cola")).toBe(
      "amarillo",
    );
    expect(level({ ...calm, queue: { pending: 10, oldestPendingAt: hoursAgo(30) } }, "cola")).toBe(
      "rojo",
    );
    expect(level({ ...calm, queue: { pending: 60, oldestPendingAt: hoursAgo(1) } }, "cola")).toBe(
      "amarillo",
    );
    expect(level({ ...calm, queue: { pending: 201, oldestPendingAt: hoursAgo(1) } }, "cola")).toBe(
      "rojo",
    );
    expect(level({ ...calm, queue: { pending: 0, oldestPendingAt: null } }, "cola")).toBe("verde");
  });

  it("IA: contra LLM_DAILY_CAP_USD; sin tope, gris", () => {
    expect(level({ ...calm, llm: { spent24hUsd: 2.1, capUsd: 4 } }, "ia")).toBe("amarillo");
    expect(level({ ...calm, llm: { spent24hUsd: 3.7, capUsd: 4 } }, "ia")).toBe("rojo");
    expect(level({ ...calm, llm: { spent24hUsd: 3, capUsd: null } }, "ia")).toBe("gris");
  });

  it("emails: contra los 100 por día de Resend", () => {
    expect(RESEND_DAILY_CAP).toBe(100);
    expect(level({ ...calm, emails: { sentToday: 55, receivedToday: 0 } }, "emails")).toBe(
      "amarillo",
    );
    expect(level({ ...calm, emails: { sentToday: 85, receivedToday: 0 } }, "emails")).toBe("rojo");
  });

  it("errores de ingesta y feedback nuevo piden mirar", () => {
    expect(level({ ...calm, ingestErrors24h: { inbound: 2, pool: 2 } }, "ingesta")).toBe(
      "amarillo",
    );
    expect(level({ ...calm, ingestErrors24h: { inbound: 8, pool: 4 } }, "ingesta")).toBe("rojo");
    expect(level({ ...calm, feedback24h: 2 }, "feedback")).toBe("amarillo");
    expect(level({ ...calm, activeToday: 0 }, "activas")).toBe("gris");
  });

  it("el general es el peor de los semáforos", () => {
    expect(betaHealth({ ...calm, llm: { spent24hUsd: 3.9, capUsd: 4 } }).overall).toBe("rojo");
  });

  it("los textos dicen el número y contra qué se compara", () => {
    const rows = betaHealth({ ...calm, llm: { spent24hUsd: 2.1, capUsd: 4 } }).rows;
    expect(rows.find((r) => r.key === "ia")!.value).toBe("USD 2,10 de 4,00");
    expect(rows.find((r) => r.key === "cola")!.value).toBe("4 en cola · la más vieja, hace 1 h");
    expect(rows.find((r) => r.key === "emails")!.value).toBe("6 de 100");
  });
});
