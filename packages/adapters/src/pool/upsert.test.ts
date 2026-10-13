import type { RawJob } from "@job-search-os/pipeline";
import { describe, expect, it } from "vitest";
import {
  POOL_UPSERT_CHUNK,
  POOL_UPSERT_ESTIMATE_FACTOR,
  POOL_UPSERT_INITIAL_MS_PER_JOB,
  chunkPoolJobs,
  estimateBatchMs,
} from "./upsert";

function job(kind: string, externalId: string | null): RawJob {
  return { source: { kind, externalId } } as unknown as RawJob;
}

describe("chunkPoolJobs", () => {
  it("agrupa consecutivos del mismo board ATS por proveedor:token", () => {
    const raws = [
      job("greenhouse", "greenhouse:empresa-a:1"),
      job("greenhouse", "greenhouse:empresa-a:2"),
      job("greenhouse", "greenhouse:empresa-b:3"),
      job("greenhouse", "greenhouse:empresa-a:4"),
    ];
    expect(chunkPoolJobs(raws).map((c) => c.length)).toEqual([2, 1, 1]);
  });

  it("en el resto de las fuentes la clave es la fuente", () => {
    const raws = [job("remoteok", "1"), job("remoteok", "2"), job("jobicy", "3")];
    expect(chunkPoolJobs(raws).map((c) => c.length)).toEqual([2, 1]);
  });

  it("un board de 200 son dos lotes de a lo sumo el tope, en orden", () => {
    const raws = Array.from({ length: 200 }, (_, i) => job("lever", `lever:tok:${i}`));
    const chunks = chunkPoolJobs(raws);
    expect(chunks.map((c) => c.length)).toEqual([POOL_UPSERT_CHUNK, 200 - POOL_UPSERT_CHUNK]);
    expect(chunks.flat()).toEqual(raws);
  });

  it("sin avisos no hay lotes", () => {
    expect(chunkPoolJobs([])).toEqual([]);
  });
});

describe("estimateBatchMs", () => {
  it("antes del primer lote usa el valor inicial", () => {
    expect(estimateBatchMs(10, 0, 0)).toBe(
      10 * POOL_UPSERT_INITIAL_MS_PER_JOB * POOL_UPSERT_ESTIMATE_FACTOR,
    );
  });
  it("después usa el promedio medido, con el factor de seguridad", () => {
    expect(estimateBatchMs(50, 1000, 100)).toBe(500 * POOL_UPSERT_ESTIMATE_FACTOR);
  });
});
