import { describe, expect, it } from "vitest";
import { checkPersonQuota, MAX_MANUAL_JOBS_PER_PERSON, MAX_RAW_BYTES_PER_PERSON } from "./quota";

describe("checkPersonQuota", () => {
  it("deja pasar a una persona normal", () => {
    expect(
      checkPersonQuota(
        { manualJobs: 40, rawBytes: 5_000_000 },
        { newManualJobs: 1, incomingBytes: 60_000 },
      ),
    ).toEqual({ ok: true });
  });

  it("la última oferta que entra justo en el tope pasa y la siguiente no", () => {
    const add = { newManualJobs: 1, incomingBytes: 0 };
    expect(
      checkPersonQuota({ manualJobs: MAX_MANUAL_JOBS_PER_PERSON - 1, rawBytes: 0 }, add).ok,
    ).toBe(true);
    expect(checkPersonQuota({ manualJobs: MAX_MANUAL_JOBS_PER_PERSON, rawBytes: 0 }, add)).toEqual({
      ok: false,
      kind: "manual_jobs",
    });
  });

  it("frena por bytes cuando lo nuevo pasa el tope", () => {
    expect(
      checkPersonQuota(
        { manualJobs: 0, rawBytes: MAX_RAW_BYTES_PER_PERSON - 10 },
        { newManualJobs: 0, incomingBytes: 11 },
      ),
    ).toEqual({ ok: false, kind: "raw_bytes" });
  });

  it("pegar una JD en una oferta existente no cuenta como oferta nueva", () => {
    expect(
      checkPersonQuota(
        { manualJobs: MAX_MANUAL_JOBS_PER_PERSON, rawBytes: 0 },
        { newManualJobs: 0, incomingBytes: 1_000 },
      ),
    ).toEqual({ ok: true });
  });
});
