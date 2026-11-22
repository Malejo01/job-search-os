import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { applyMigrations } from "@job-search-os/db/src/migrate";
import { createDb, isRemoteDatabase, schema as s } from "@job-search-os/db";
import {
  CV_COACH_MAX_TURNS,
  type CvCoachState,
  type CvCoachTurnOutput,
  type CvIssue,
} from "@job-search-os/pipeline";
import { and, eq, like } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createFakeLlm } from "../../llm/fake";
import { CV_RESERVE_TASK } from "../../cv-chat/reserve";
import { dbCoachTurnReserve, runCoachTurn, type CoachTurnParams } from "./turn";

/**
 * El turno del coach con la reserva real (`reserveCvCoachStep`) contra Postgres, con datos inventados:
 * - tope de 15 turnos por charla, contado en `llm_calls` por `label`;
 * - O1 de ADR-034: filas fallidas con `cost_usd` null valen la reserva del paso y cortan por USD antes de
 *   dejar sin lugar a la redacción;
 * - en ambos casos no se llama al modelo y la reserva viva se suelta después de un turno que sí llamó.
 */
const USER = "00000000-0000-4000-8000-0000000c0b01";
const FLOW = "c0ac4000a0b1";
const LABEL = `cv:${FLOW}`;
const ID_A = "00000000-0000-4000-8000-00000000000a";

let container: StartedPostgreSqlContainer | null = null;
let conn: ReturnType<typeof createDb>;

async function clean() {
  await conn.db.delete(s.llmCalls).where(like(s.llmCalls.label, LABEL));
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
  if (isRemoteDatabase(ownerUrl))
    throw new Error("cv-coach turn.integration: DATABASE_URL no es local");
  await applyMigrations(ownerUrl, { log: () => {} });
  conn = createDb(ownerUrl, { max: 4 });
}, 180_000);

beforeEach(clean);

afterAll(async () => {
  await clean();
  await conn?.close();
  await container?.stop();
});

const ISSUE: CvIssue = {
  id: "iss:0",
  type: "logro_sin_resultado",
  ref: { section: "experience", itemId: ID_A, field: "bullets" },
  quote: null,
  skillSlug: null,
  severity: "alta",
  source: "model",
};
const STATE: CvCoachState = {
  stage: "chat",
  current: "iss:0",
  resolved: [],
  skipped: [],
  followUps: 0,
  failures: 0,
  turnsShown: 0,
};
const OUTPUT: CvCoachTurnOutput = {
  patch: {
    title: null,
    organization: null,
    startMonth: null,
    endMonth: null,
    isCurrent: null,
    bullets: ["Automaticé los reportes"],
    link: null,
    stack: [],
  },
  extras: [],
  declined: false,
  nextQuestion: null,
};

const params: CoachTurnParams = {
  userId: USER,
  flowId: FLOW,
  issues: [ISSUE],
  target: "Analista de datos",
  items: [
    {
      id: ID_A,
      section: "experience",
      organization: "Empresa A",
      title: "Analista de datos",
      startMonth: "2025-02",
      endMonth: null,
      isCurrent: true,
      bullets: [],
      link: null,
    },
  ],
  skillNames: {},
  state: STATE,
  answer: { kind: "text", issueId: "iss:0", text: "En Empresa A automaticé los reportes" },
  now: new Date(),
};

const call = (over: Record<string, unknown>) =>
  conn.db.insert(s.llmCalls).values({
    userId: USER,
    task: "cv_coach_turn",
    model: "fake",
    ok: true,
    costUsd: 0.001,
    label: LABEL,
    ...over,
  });

const liveReservations = () =>
  conn.db
    .select({ id: s.llmCalls.id })
    .from(s.llmCalls)
    .where(and(eq(s.llmCalls.task, CV_RESERVE_TASK), eq(s.llmCalls.label, LABEL)));

describe("runCoachTurn con la reserva real", () => {
  it("un turno llama una vez al modelo y suelta su reserva", async () => {
    const llm = createFakeLlm({ cv_coach_turn: OUTPUT });
    const out = await runCoachTurn(
      { llm, reserve: dbCoachTurnReserve(conn.db, { dailyCapUsd: 100 }) },
      params,
    );
    expect(out.kind).toBe("turn");
    expect(llm.calls).toHaveLength(1);
    expect(await liveReservations()).toHaveLength(0);
  });

  it(`con ${CV_COACH_MAX_TURNS} turnos ya hechos, corta sin llamar al modelo`, async () => {
    for (let i = 0; i < CV_COACH_MAX_TURNS; i++) await call({});
    const llm = createFakeLlm({ cv_coach_turn: OUTPUT });
    const out = await runCoachTurn(
      { llm, reserve: dbCoachTurnReserve(conn.db, { dailyCapUsd: 100 }) },
      params,
    );
    expect(out).toMatchObject({ kind: "cap", reject: "turnos", state: { stage: "done" } });
    expect(llm.calls).toHaveLength(0);
  });

  it("filas fallidas con costo null valen la reserva del turno y cortan por USD, con la redacción reservada", async () => {
    await call({ task: "extract_cv_profile", costUsd: 0.02 });
    await call({ task: "cv_review", costUsd: 0.01 });
    for (let i = 0; i < 3; i++) await call({ ok: false, costUsd: null, error: "output_invalid" });
    // 0,02 + 0,01 + 3 × 0,045 + 0,045 (turno) + 0,08 (redacción) = 0,29 → todavía entra
    const llm = createFakeLlm({ cv_coach_turn: OUTPUT });
    const reserve = dbCoachTurnReserve(conn.db, { dailyCapUsd: 100 });
    const fourth = await runCoachTurn({ llm, reserve }, params);
    expect(fourth.kind).toBe("turn");
    // el fake no escribe en llm_calls: la fila de ese turno, fallida y sin costo
    await call({ ok: false, costUsd: null, error: "output_invalid" });
    // 0,03 + 4 × 0,045 + 0,045 + 0,08 = 0,335 > 0,30 → corta
    const fifth = await runCoachTurn({ llm, reserve }, params);
    expect(fifth).toMatchObject({ kind: "cap", reject: "charla" });
    expect(llm.calls).toHaveLength(1);
  });
});
