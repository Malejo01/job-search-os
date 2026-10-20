import { describe, expect, it } from "vitest";
import { checkBearerSecret } from "../auth/secret";
import {
  evaluateStatus,
  statusExpectedSecret,
  QUEUE_OLDEST_MAX_HOURS,
  POOL_STALE_MAX_HOURS,
  type StatusFetch,
  type StatusSnapshot,
} from "./status";

const NOW = new Date("2026-10-20T12:00:00.000Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

const fetchOf = (status: string, h = 1): StatusFetch => ({
  startedAt: hoursAgo(h),
  status,
  errorCode: status === "error" ? "timeout" : null,
  fetched: 10,
  inserted: 2,
});

const healthy = (): StatusSnapshot => ({
  poolLastSeenAt: hoursAgo(2),
  sources: [{ source: "getonboard_api", recent: [fetchOf("ok"), fetchOf("ok", 7)] }],
  queue: { pending: 3, failed24h: 0, oldestPendingMinutes: 90 },
  lastEvaluationAt: hoursAgo(5),
});

const check = (snap: StatusSnapshot, name: string) =>
  evaluateStatus(snap, NOW).checks.find((c) => c.name === name);

describe("statusExpectedSecret", () => {
  it("con STATUS_TOKEN rige solo ese; vacío o ausente cae a CRON_SECRET", () => {
    expect(statusExpectedSecret({ STATUS_TOKEN: "tok", CRON_SECRET: "cron" })).toBe("tok");
    expect(statusExpectedSecret({ STATUS_TOKEN: "", CRON_SECRET: "cron" })).toBe("cron");
    expect(statusExpectedSecret({ CRON_SECRET: "cron" })).toBe("cron");
    expect(statusExpectedSecret({})).toBeUndefined();
  });

  it("con STATUS_TOKEN el CRON_SECRET no autoriza", () => {
    const expected = statusExpectedSecret({ STATUS_TOKEN: "tok", CRON_SECRET: "cron" });
    expect(checkBearerSecret({ authorization: "Bearer cron", expected })).toBe(false);
    expect(checkBearerSecret({ authorization: "Bearer tok", expected })).toBe(true);
  });
});

describe("evaluateStatus", () => {
  it("todo sano: ok", () => {
    const r = evaluateStatus(healthy(), NOW);
    expect(r.ok).toBe(true);
    expect(check(healthy(), "pool_freshness_hours")).toMatchObject({ ok: true, value: 2 });
  });

  it("pool: justo en el umbral pasa, más allá falla, vacío falla", () => {
    const at = { ...healthy(), poolLastSeenAt: hoursAgo(POOL_STALE_MAX_HOURS) };
    expect(check(at, "pool_freshness_hours")?.ok).toBe(true);
    const over = { ...healthy(), poolLastSeenAt: hoursAgo(POOL_STALE_MAX_HOURS + 0.5) };
    const r = evaluateStatus(over, NOW);
    expect(r.ok).toBe(false);
    expect(check(over, "pool_freshness_hours")?.ok).toBe(false);
    expect(check({ ...healthy(), poolLastSeenAt: null }, "pool_freshness_hours")?.ok).toBe(false);
  });

  it("cola: pendiente de más de 26 h falla; sin pendientes pasa", () => {
    const stuck = {
      ...healthy(),
      queue: { pending: 4, failed24h: 0, oldestPendingMinutes: (QUEUE_OLDEST_MAX_HOURS + 1) * 60 },
    };
    expect(evaluateStatus(stuck, NOW).ok).toBe(false);
    expect(check(stuck, "queue_oldest_pending_hours")).toMatchObject({ ok: false, value: 27 });
    const empty = {
      ...healthy(),
      queue: { pending: 0, failed24h: 0, oldestPendingMinutes: null },
    };
    expect(check(empty, "queue_oldest_pending_hours")).toMatchObject({ ok: true, value: null });
  });

  it("fuente: 3 errores seguidos fallan; 2 o con un ok en el medio no", () => {
    const three = {
      ...healthy(),
      sources: [
        {
          source: "remoteok",
          recent: [fetchOf("error"), fetchOf("error", 7), fetchOf("error", 13)],
        },
      ],
    };
    expect(evaluateStatus(three, NOW).ok).toBe(false);
    expect(check(three, "source_consecutive_errors:remoteok")).toMatchObject({
      ok: false,
      value: 3,
    });
    const two = {
      ...healthy(),
      sources: [
        { source: "remoteok", recent: [fetchOf("error"), fetchOf("error", 7), fetchOf("ok", 13)] },
      ],
    };
    expect(evaluateStatus(two, NOW).ok).toBe(true);
    const broken = {
      ...healthy(),
      sources: [
        { source: "remoteok", recent: [fetchOf("error"), fetchOf("ok", 7), fetchOf("error", 13)] },
      ],
    };
    expect(check(broken, "source_consecutive_errors:remoteok")?.value).toBe(1);
  });

  it("los checks informativos no tumban el estado y no filtran datos de usuarios", () => {
    const snap = { ...healthy(), queue: { pending: 9, failed24h: 5, oldestPendingMinutes: 10 } };
    const r = evaluateStatus(snap, NOW);
    expect(r.ok).toBe(true);
    expect(check(snap, "queue_failed_24h")).toMatchObject({ ok: true, value: 5, threshold: null });
    expect(check(snap, "last_evaluation_at")?.value).toBe(hoursAgo(5).toISOString());
    expect(Object.keys(r)).toEqual(["ok", "checks"]);
  });
});
