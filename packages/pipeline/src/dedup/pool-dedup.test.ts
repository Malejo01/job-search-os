import { describe, expect, it } from "vitest";
import { poolDedup, type PoolDedupCandidate, type PoolRecent } from "./pool-dedup";
import { textShingles } from "./similarity";

const TEXT_A =
  "Buscamos una persona para desarrollar servicios backend en Node con PostgreSQL, colas de mensajes, " +
  "pruebas automatizadas y despliegues continuos en la nube, trabajando junto al equipo de producto.";
const TEXT_B =
  "Equipo de datos que necesita alguien con experiencia en modelado dimensional, dashboards, SQL avanzado " +
  "y comunicación con áreas de negocio para definir métricas y reportes mensuales.";

const day = (n: number) => new Date(Date.UTC(2026, 9, n));

function candidate(over: Partial<PoolDedupCandidate> = {}): PoolDedupCandidate {
  return {
    sourceKind: "remoteok",
    externalId: "100",
    canonicalUrl: "https://example.com/jobs/100",
    jdHash: "hash-a",
    jdShingles: textShingles(TEXT_A),
    companyNormalized: "empresa ficticia 1",
    seenAt: day(10),
    ...over,
  };
}

function recent(over: Partial<PoolRecent> = {}): PoolRecent {
  return {
    sourceKind: "jobicy",
    externalId: "900",
    canonicalUrl: "https://example.com/otra/900",
    jdHash: "hash-z",
    jdShingles: textShingles(TEXT_B),
    companyNormalized: "empresa ficticia 1",
    seenAt: day(9),
    id: "r1",
    firstSeenAt: day(9),
    dedupOfId: null,
    ...over,
  };
}

describe("poolDedup", () => {
  it("mismo sourceKind y externalId es la misma fila", () => {
    const row = recent({ id: "r-same", sourceKind: "remoteok", externalId: "100" });
    expect(poolDedup(candidate(), [recent(), row])).toEqual({ kind: "same", id: "r-same" });
  });

  it("el mismo externalId en otra fuente no es la misma fila", () => {
    const row = recent({
      sourceKind: "jobicy",
      externalId: "100",
      jdShingles: textShingles(TEXT_B),
    });
    expect(poolDedup(candidate(), [row]).kind).toBe("new");
  });

  it("misma canonicalUrl es copia, aunque sea de otra empresa", () => {
    const row = recent({
      id: "r-url",
      canonicalUrl: "https://example.com/jobs/100",
      companyNormalized: "otra empresa",
    });
    expect(poolDedup(candidate(), [row])).toEqual({
      kind: "copy_of",
      id: "r-url",
      reason: "url",
      similarity: 1,
    });
  });

  it("mismo jdHash es copia", () => {
    const row = recent({ id: "r-hash", jdHash: "hash-a" });
    expect(poolDedup(candidate(), [row])).toMatchObject({
      kind: "copy_of",
      id: "r-hash",
      reason: "jd_hash",
    });
  });

  it("texto casi igual de la misma empresa dentro de la ventana es copia", () => {
    const row = recent({ id: "r-text", jdShingles: textShingles(`${TEXT_A} Remoto.`) });
    const out = poolDedup(candidate(), [row]);
    expect(out).toMatchObject({ kind: "copy_of", id: "r-text", reason: "jd_text" });
    expect(out.kind === "copy_of" && out.similarity).toBeGreaterThanOrEqual(0.9);
  });

  it("texto igual de otra empresa no marca nada", () => {
    const row = recent({
      companyNormalized: "empresa ficticia 2",
      jdShingles: textShingles(TEXT_A),
    });
    expect(poolDedup(candidate(), [row])).toEqual({ kind: "new" });
  });

  it("texto igual fuera de la ventana no marca", () => {
    const row = recent({ jdShingles: textShingles(TEXT_A), firstSeenAt: day(10 - 15) });
    expect(poolDedup(candidate(), [row])).toEqual({ kind: "new" });
    const inside = recent({ jdShingles: textShingles(TEXT_A), firstSeenAt: day(10 - 14) });
    expect(poolDedup(candidate(), [inside]).kind).toBe("copy_of");
  });

  it("empresa y título parecidos sin otra señal no marcan", () => {
    const row = recent({ jdShingles: textShingles(TEXT_B) });
    expect(poolDedup(candidate(), [row])).toEqual({ kind: "new" });
  });

  it("apunta a la raíz cuando la fila encontrada ya es copia", () => {
    const row = recent({ id: "r-copy", jdHash: "hash-a", dedupOfId: "r-root" });
    expect(poolDedup(candidate(), [row])).toMatchObject({ kind: "copy_of", id: "r-root" });
  });

  it("entre varias coincidencias elige la de firstSeenAt más antigua", () => {
    const newer = recent({ id: "newer", jdHash: "hash-a", firstSeenAt: day(9) });
    const older = recent({ id: "older", jdHash: "hash-a", firstSeenAt: day(5) });
    expect(poolDedup(candidate(), [newer, older])).toMatchObject({ id: "older" });
    expect(poolDedup(candidate(), [older, newer])).toMatchObject({ id: "older" });
  });

  it("los dos órdenes de llegada marcan a la más nueva como copia de la más antigua", () => {
    const first = candidate({ sourceKind: "remoteok", externalId: "1", canonicalUrl: null });
    const second = candidate({
      sourceKind: "jobicy",
      externalId: "2",
      canonicalUrl: null,
      jdHash: "hash-b",
      seenAt: day(11),
    });
    // Llega primero la de remoteok: la de jobicy es copia de ella
    const firstRow: PoolRecent = { ...first, id: "A", firstSeenAt: first.seenAt, dedupOfId: null };
    expect(poolDedup(second, [firstRow])).toMatchObject({ kind: "copy_of", id: "A" });
    // Llega primero la de jobicy: la de remoteok es copia de ella
    const secondRow: PoolRecent = {
      ...second,
      id: "B",
      firstSeenAt: second.seenAt,
      dedupOfId: null,
    };
    expect(poolDedup(first, [secondRow])).toMatchObject({ kind: "copy_of", id: "B" });
  });

  it("empresa genérica no compara texto", () => {
    const row = recent({ companyNormalized: "confidencial", jdShingles: textShingles(TEXT_A) });
    const out = poolDedup(candidate({ companyNormalized: "confidencial" }), [row]);
    expect(out).toEqual({ kind: "new" });
  });

  it("sin JD de algún lado no compara texto", () => {
    const row = recent({ jdShingles: textShingles(TEXT_A) });
    expect(poolDedup(candidate({ jdShingles: null }), [row])).toEqual({ kind: "new" });
    expect(poolDedup(candidate(), [recent({ jdShingles: null })])).toEqual({ kind: "new" });
  });

  it("respeta windowDays y textThreshold de las opciones", () => {
    const row = recent({ jdShingles: textShingles(TEXT_A), firstSeenAt: day(10 - 5) });
    expect(poolDedup(candidate(), [row], { windowDays: 3 })).toEqual({ kind: "new" });
    const near = recent({ jdShingles: textShingles(`${TEXT_A} Remoto.`) });
    expect(poolDedup(candidate(), [near], { textThreshold: 0.99 })).toEqual({ kind: "new" });
  });

  it("sin filas recientes es new", () => {
    expect(poolDedup(candidate(), [])).toEqual({ kind: "new" });
  });
});
