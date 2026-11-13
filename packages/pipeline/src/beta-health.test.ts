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
  evalQueue24h: { failed: 0, finished: 40 },
  pool: { lastOkAt: hoursAgo(2) },
  inboundNoParser7d: { total: 0, byHost: [] },
  invitations: { pending: 0, expiringIn48h: 0 },
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
      "evaluaciones",
      "pool",
      "portales",
      "invitaciones",
    ]);
  });

  it("evaluaciones fallidas (24 h): 3 piden mirar, más de 10 o más de la mitad de los intentos, actuar", () => {
    const key = "evaluaciones";
    expect(level({ ...calm, evalQueue24h: { failed: 2, finished: 40 } }, key)).toBe("verde");
    expect(level({ ...calm, evalQueue24h: { failed: 3, finished: 40 } }, key)).toBe("amarillo");
    expect(level({ ...calm, evalQueue24h: { failed: 11, finished: 80 } }, key)).toBe("rojo");
    // Con pocos intentos el porcentaje no dice nada; con 4 o más, más de la mitad es rojo
    expect(level({ ...calm, evalQueue24h: { failed: 3, finished: 3 } }, key)).toBe("amarillo");
    expect(level({ ...calm, evalQueue24h: { failed: 3, finished: 5 } }, key)).toBe("rojo");
    expect(level({ ...calm, evalQueue24h: { failed: 0, finished: 0 } }, key)).toBe("verde");
    const row = betaHealth({ ...calm, evalQueue24h: { failed: 3, finished: 40 } }).rows.find(
      (r) => r.key === key,
    )!;
    expect(row.value).toBe("3 fallidas de 40 terminadas");
  });

  it("pool: la última descarga buena, contra el cron de 6 h (amarillo pasadas 7 h, rojo pasadas 13 h)", () => {
    expect(level({ ...calm, pool: { lastOkAt: hoursAgo(5) } }, "pool")).toBe("verde");
    expect(level({ ...calm, pool: { lastOkAt: hoursAgo(8) } }, "pool")).toBe("amarillo");
    expect(level({ ...calm, pool: { lastOkAt: hoursAgo(14) } }, "pool")).toBe("rojo");
    expect(level({ ...calm, pool: { lastOkAt: null } }, "pool")).toBe("gris");
    const row = betaHealth({ ...calm, pool: { lastOkAt: hoursAgo(8) } }).rows.find(
      (r) => r.key === "pool",
    )!;
    expect(row.value).toBe("hace 8 h");
  });

  it("portales: emails de 7 días sin parser, con el dominio de los portales conocidos y el resto como «otros»", () => {
    const four = { total: 4, byHost: [{ host: "mail.computrabajo.com.ar", count: 4 }] };
    expect(level({ ...calm, inboundNoParser7d: four }, "portales")).toBe("verde");
    const nine = {
      total: 10,
      byHost: [
        { host: "avisos.computrabajo.com.ar", count: 5 },
        { host: "alertas.computrabajo.com.ar", count: 2 },
        { host: "bumeran.com.ar", count: 2 },
        { host: "empresa-a.example", count: 1 },
      ],
    };
    expect(level({ ...calm, inboundNoParser7d: nine }, "portales")).toBe("amarillo");
    expect(level({ ...calm, inboundNoParser7d: { total: 30, byHost: [] } }, "portales")).toBe(
      "rojo",
    );
    const row = betaHealth({ ...calm, inboundNoParser7d: nine }).rows.find(
      (r) => r.key === "portales",
    )!;
    expect(row.value).toBe("10 · computrabajo.com.ar 7 · bumeran.com.ar 2 · otros 1");
    // Un dominio que no es un portal conocido nunca se nombra
    expect(row.value).not.toContain("empresa-a");
    expect(betaHealth({ ...calm }).rows.find((r) => r.key === "portales")!.value).toBe("Ninguno");
  });

  it("invitaciones: pendientes y las que vencen en 48 h", () => {
    expect(level({ ...calm, invitations: { pending: 0, expiringIn48h: 0 } }, "invitaciones")).toBe(
      "gris",
    );
    expect(level({ ...calm, invitations: { pending: 5, expiringIn48h: 0 } }, "invitaciones")).toBe(
      "verde",
    );
    expect(level({ ...calm, invitations: { pending: 5, expiringIn48h: 2 } }, "invitaciones")).toBe(
      "amarillo",
    );
    const row = betaHealth({ ...calm, invitations: { pending: 5, expiringIn48h: 2 } }).rows.find(
      (r) => r.key === "invitaciones",
    )!;
    expect(row.value).toBe("5 sin usar · 2 vencen en 48 h");
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
    // R-5: solo en proceso (ninguna pendiente) no es «Vacía»
    const processing = betaHealth({ ...calm, queue: { pending: 3, oldestPendingAt: null } });
    expect(processing.rows[0]!.value).toBe("3 en proceso");
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
