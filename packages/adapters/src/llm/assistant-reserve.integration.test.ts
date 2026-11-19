import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { applyMigrations } from "@job-search-os/db/src/migrate";
import { createDb, schema as s } from "@job-search-os/db";
import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ASSISTANT_TASK } from "./agent";
import {
  ASSISTANT_TURN_BUSY_MS,
  ASSISTANT_TURN_RESERVE_USD,
  releaseAssistantTurn,
  reserveAssistantTurn,
} from "./assistant-reserve";

/** Reserva del turno del asistente contra la base, con pedidos en paralelo. Sin modelo. Datos inventados. */
const USERS = Array.from({ length: 6 }, (_, i) => `a3170000-0000-4000-8000-00000000000${i + 1}`);
const A = USERS[0]!;
const NOW = new Date("2026-11-18T12:00:00Z");
const clock = () => NOW;

let container: StartedPostgreSqlContainer | null = null;
let conn: ReturnType<typeof createDb>;

const base = { monthlyLimit: 3, now: clock, dailyCapUsd: 0, userDailyCapUsd: 0 };

/** Deja la charla registrada como lo hace el asistente al terminar un paso del modelo. */
async function finishedConversation(userId: string, label: string, costUsd = 0): Promise<void> {
  await conn.db.insert(s.llmCalls).values({
    userId,
    task: ASSISTANT_TASK,
    model: "modelo-falso",
    label,
    costUsd,
    ok: true,
    createdAt: NOW,
  });
}

beforeAll(async () => {
  let ownerUrl = process.env.DATABASE_URL;
  if (!ownerUrl) {
    container = await new PostgreSqlContainer("pgvector/pgvector:pg16")
      .withDatabase("jobsearch")
      .withUsername("postgres")
      .withPassword("postgres")
      .start();
    ownerUrl = container.getConnectionUri();
  }
  await applyMigrations(ownerUrl, { log: () => {} });
  conn = createDb(ownerUrl, { max: 8 });
  await conn.db
    .insert(s.users)
    .values(USERS.map((id, i) => ({ id, email: `asistente-${i}@example.com` })))
    .onConflictDoNothing();
}, 180_000);

beforeEach(async () => {
  await conn.db.delete(s.llmCalls).where(inArray(s.llmCalls.userId, USERS));
});

afterAll(async () => {
  await conn?.db.delete(s.llmCalls).where(inArray(s.llmCalls.userId, USERS));
  await conn?.db.delete(s.users).where(inArray(s.users.id, USERS));
  await conn?.close();
  await container?.stop();
});

describe("reserveAssistantTurn", () => {
  it("con charlas nuevas en paralelo de una persona acepta una sola", async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        reserveAssistantTurn(conn.db, { ...base, userId: A, label: `conv:paralela-${i}` }),
      ),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.reason === "busy")).toHaveLength(7);
  });

  it("al soltar el turno la persona puede seguir", async () => {
    const first = await reserveAssistantTurn(conn.db, { ...base, userId: A, label: "conv:uno" });
    expect(first.ok).toBe(true);
    if (first.ok) await releaseAssistantTurn(conn.db, first.reservationId);
    const second = await reserveAssistantTurn(conn.db, { ...base, userId: A, label: "conv:uno" });
    expect(second.ok).toBe(true);
  });

  it("un turno colgado deja de bloquear cuando pasa la ventana", async () => {
    await reserveAssistantTurn(conn.db, { ...base, userId: A, label: "conv:colgada" });
    const later = new Date(NOW.getTime() + ASSISTANT_TURN_BUSY_MS + 1_000);
    const next = await reserveAssistantTurn(conn.db, {
      ...base,
      userId: A,
      label: "conv:colgada",
      now: () => later,
    });
    expect(next.ok).toBe(true);
  });

  it("una charla nueva no entra si ya se usó el cupo del mes", async () => {
    await finishedConversation(A, "conv:mes-1");
    await finishedConversation(A, "conv:mes-2");
    await finishedConversation(A, "conv:mes-3");
    const result = await reserveAssistantTurn(conn.db, { ...base, userId: A, label: "conv:mes-4" });
    expect(result).toEqual({ ok: false, reason: "monthly" });
  });

  it("una charla que ya existe sigue aunque el cupo del mes esté lleno", async () => {
    await finishedConversation(A, "conv:mes-1");
    await finishedConversation(A, "conv:mes-2");
    await finishedConversation(A, "conv:mes-3");
    const result = await reserveAssistantTurn(conn.db, { ...base, userId: A, label: "conv:mes-3" });
    expect(result.ok).toBe(true);
  });

  it("una charla en curso cuenta contra el cupo aunque todavía no tenga pasos registrados", async () => {
    const first = await reserveAssistantTurn(conn.db, {
      ...base,
      monthlyLimit: 1,
      userId: A,
      label: "conv:en-curso",
    });
    expect(first.ok).toBe(true);
    const later = new Date(NOW.getTime() + ASSISTANT_TURN_BUSY_MS + 1_000);
    const second = await reserveAssistantTurn(conn.db, {
      ...base,
      monthlyLimit: 1,
      userId: A,
      label: "conv:otra",
      now: () => later,
    });
    expect(second).toEqual({ ok: false, reason: "monthly" });
  });

  it("con cupo 0 no acepta charlas nuevas", async () => {
    const result = await reserveAssistantTurn(conn.db, {
      ...base,
      monthlyLimit: 0,
      userId: A,
      label: "conv:sin-cupo",
    });
    expect(result).toEqual({ ok: false, reason: "monthly" });
  });

  it("personas distintas en paralelo respetan el tope global", async () => {
    const results = await Promise.all(
      USERS.map((userId, i) =>
        reserveAssistantTurn(conn.db, {
          ...base,
          userId,
          label: `conv:global-${i}`,
          dailyCapUsd: ASSISTANT_TURN_RESERVE_USD * 2,
        }),
      ),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(2);
    expect(results.filter((r) => !r.ok && r.reason === "global")).toHaveLength(4);
  });

  it("el gasto del día de la persona frena el turno", async () => {
    await finishedConversation(A, "conv:cara", 0.5);
    const result = await reserveAssistantTurn(conn.db, {
      ...base,
      userId: A,
      label: "conv:cara",
      userDailyCapUsd: 0.5,
    });
    expect(result).toEqual({ ok: false, reason: "user" });
  });
});
