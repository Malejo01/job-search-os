import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import golden from "../../../../evals/fixtures/golden.json";
import { normalizeCompany } from "../normalize/company";
import { titleTokens } from "../normalize/title";
import { dedup, type DedupCandidate, type RecentJob } from "./dedup";
import { textShingles } from "./similarity";
import regressions from "./fixtures/regressions.json";

type GoldenJob = {
  id: number;
  empresa: string;
  titulo: string;
  fecha: string;
  stack: string[];
};
const jobs = golden.jobs as GoldenJob[];
const g = (id: number) => jobs.find((j) => j.id === id)!;

/**
 * El golden no trae la JD: la sintetizamos desde el stack, larga y estable. El título no va en
 * el cuerpo (es un campo aparte), como en un aviso real.
 */
function jdFromStack(j: GoldenJob, extra = ""): string {
  const body = j.stack
    .map((s) => `Requisito: ${s}. Se valora experiencia comprobable en ${s} en proyectos reales.`)
    .join(" ");
  return `Buscamos sumar al equipo de ${j.empresa} una persona con este perfil. ${body} Modalidad remota, contratación inmediata, equipo distribuido en varias zonas horarias. ${extra}`.trim();
}

function fromGolden(
  j: GoldenJob,
  opts: { jd?: string | null; url?: string | null } = {},
): RecentJob {
  const jd = opts.jd === undefined ? null : opts.jd;
  return {
    id: `job-${j.id}`,
    canonicalUrl: opts.url ?? null,
    externalIds: [],
    companyNormalized: normalizeCompany(j.empresa),
    titleTokens: titleTokens(j.titulo),
    jdShingles: jd ? textShingles(jd) : null,
    firstSeenAt: `${j.fecha}T12:00:00Z`,
  };
}

function candidateFrom(
  j: GoldenJob,
  opts: { jd?: string | null; url?: string | null; externalId?: string } = {},
): DedupCandidate {
  const jd = opts.jd === undefined ? null : opts.jd;
  return {
    canonicalUrl: opts.url ?? null,
    sourceKind: "email_linkedin",
    externalId: opts.externalId ?? null,
    companyNormalized: normalizeCompany(j.empresa),
    titleTokens: titleTokens(j.titulo),
    jdShingles: jd ? textShingles(jd) : null,
    seenAt: `${j.fecha}T13:00:00Z`,
  };
}

describe("dedup: pares del golden (ADR-006)", () => {
  it("19/20 Empresa Q: >90% de texto compartido con título distinto → merge + volume_recruiting", () => {
    // Mismo stack: la JD 20 es la 19 más una frase ("código AI" sin tecnología concreta)
    const jd19 = jdFromStack(g(19));
    const jd20 = jdFromStack({ ...g(20), stack: g(19).stack }, "Trabajamos con código AI.");
    const r = dedup(candidateFrom(g(20), { jd: jd20 }), [fromGolden(g(19), { jd: jd19 })]);
    expect(r).toMatchObject({ kind: "merge", jobId: "job-19", reason: "jd_text" });
    if (r.kind === "merge") expect(r.flags).toContain("volume_recruiting");
  });

  it("19/20 sin JD en alguno de los dos: títulos distintos (Jaccard < 0.6) → insert", () => {
    const r = dedup(candidateFrom(g(20)), [fromGolden(g(19))]);
    expect(r).toEqual({ kind: "insert" });
  });

  it.each([
    [6, 7],
    [15, 17],
    [21, 22],
  ])("%i/%i misma empresa, roles distintos → insert", (a, b) => {
    const r = dedup(candidateFrom(g(b), { jd: jdFromStack(g(b)) }), [
      fromGolden(g(a), { jd: jdFromStack(g(a)) }),
    ]);
    expect(r).toEqual({ kind: "insert" });
  });
});

describe("dedup: claves fuertes y blandas", () => {
  const acme: GoldenJob = {
    id: 900,
    empresa: "Acme Labs",
    titulo: "AI Engineer",
    fecha: "2026-09-08",
    stack: ["RAG", "MCP"],
  };
  const recent = fromGolden(acme, { url: "https://linkedin.com/jobs/view/123" });

  it("misma canonical_url → merge por url aunque título y empresa difieran", () => {
    const other: GoldenJob = { ...acme, empresa: "Otra", titulo: "Backend Dev" };
    const r = dedup(candidateFrom(other, { url: "https://linkedin.com/jobs/view/123" }), [recent]);
    expect(r).toMatchObject({ kind: "merge", jobId: "job-900", reason: "url" });
  });

  it("mismo external_id de la misma fuente → merge", () => {
    const withExt: RecentJob = {
      ...recent,
      canonicalUrl: null,
      externalIds: ["getonboard_api:abc"],
    };
    const r = dedup({ ...candidateFrom(acme), sourceKind: "getonboard_api", externalId: "abc" }, [
      withExt,
    ]);
    expect(r).toMatchObject({ kind: "merge", reason: "external_id" });
    const otherSource = dedup(
      {
        ...candidateFrom(acme),
        sourceKind: "email_generic",
        externalId: "abc",
        titleTokens: ["x"],
      },
      [withExt],
    );
    expect(otherSource).toEqual({ kind: "insert" });
  });

  it("misma empresa + Jaccard de título ≥ 0.6 sin URL ni JD que lo confirmen → insert marcado como posible duplicado", () => {
    const similar: GoldenJob = { ...acme, titulo: "Senior AI Engineer (Remote)" };
    const r = dedup(candidateFrom(similar), [recent]);
    expect(r).toMatchObject({
      kind: "insert",
      possibleDuplicateOf: { jobId: "job-900", reason: "company_title" },
    });
  });

  it("misma empresa, título similar, pero fuera de la ventana de 14 días → insert sin marca", () => {
    const old: RecentJob = { ...recent, firstSeenAt: "2026-08-01T12:00:00Z" };
    expect(dedup(candidateFrom(acme), [old])).toEqual({ kind: "insert" });
  });

  it("otra empresa con el mismo título → insert", () => {
    const other: GoldenJob = { ...acme, empresa: "Globex" };
    expect(dedup(candidateFrom(other), [recent])).toEqual({ kind: "insert" });
  });

  it("sin jobs recientes → insert; la marca de posible duplicado apunta al más similar", () => {
    expect(dedup(candidateFrom(acme), [])).toEqual({ kind: "insert" });
    const weaker: RecentJob = {
      ...recent,
      id: "job-901",
      titleTokens: ["ai", "engineer", "platform", "cloud"],
    };
    const r = dedup(candidateFrom(acme), [weaker, recent]);
    expect(r).toMatchObject({ kind: "insert", possibleDuplicateOf: { jobId: "job-900" } });
  });

  it("mismo hash de JD → merge por jd_hash aunque URL y título difieran", () => {
    const withHash: RecentJob = { ...recent, jdHash: "abc" };
    const other: GoldenJob = { ...acme, empresa: "Otra", titulo: "Backend Dev" };
    const r = dedup({ ...candidateFrom(other, { url: "https://otra.example/1" }), jdHash: "abc" }, [
      withHash,
    ]);
    expect(r).toMatchObject({ kind: "merge", jobId: "job-900", reason: "jd_hash" });
  });

  it("empresa+título iguales y JD de los dos que no se parecen → insert sin marca: el texto desmiente", () => {
    const a = fromGolden(acme, { jd: jdFromStack(acme) });
    const b = candidateFrom(acme, {
      jd: "Rol de soporte presencial con turnos rotativos, atención de mesa de ayuda y carga de tickets.",
    });
    expect(dedup(b, [a])).toEqual({ kind: "insert" });
  });
});

/** Igual que jdHash() de packages/adapters: sha256 del texto sin mayúsculas ni espacios repetidos. */
const sha = (text: string) =>
  createHash("sha256").update(text.trim().replace(/\s+/g, " ").toLowerCase()).digest("hex");

type RegressionSide = {
  sourceKind: string;
  externalId: string | null;
  company: string;
  title: string;
  url: string;
  seenAt: string;
  jd: string | null;
};

const asRecent = (side: RegressionSide): RecentJob => ({
  id: "existing",
  canonicalUrl: side.url,
  externalIds: side.externalId ? [`${side.sourceKind}:${side.externalId}`] : [],
  companyNormalized: normalizeCompany(side.company),
  titleTokens: titleTokens(side.title),
  jdShingles: side.jd ? textShingles(side.jd) : null,
  jdHash: side.jd ? sha(side.jd) : null,
  firstSeenAt: side.seenAt,
});

const asCandidate = (side: RegressionSide): DedupCandidate => ({
  canonicalUrl: side.url,
  sourceKind: side.sourceKind,
  externalId: side.externalId,
  companyNormalized: normalizeCompany(side.company),
  titleTokens: titleTokens(side.title),
  jdShingles: side.jd ? textShingles(side.jd) : null,
  jdHash: side.jd ? sha(side.jd) : null,
  seenAt: side.seenAt,
});

describe("dedup: regresiones de producción (fixtures/regressions.json)", () => {
  it.each(regressions.cases.map((c) => [c.id, c] as const))("%s", (_id, c) => {
    // En los dos órdenes de llegada: el resultado no puede depender de cuál entró primero
    for (const [first, second] of [
      [c.a, c.b],
      [c.b, c.a],
    ] as const) {
      const r = dedup(asCandidate(second), [asRecent(first)]);
      if (c.expected === "duplicate")
        expect(r).toMatchObject({ kind: "merge", jobId: "existing", reason: c.reason });
      else if (c.expected === "possible_duplicate")
        expect(r).toMatchObject({ kind: "insert", possibleDuplicateOf: { jobId: "existing" } });
      else expect(r).toMatchObject({ kind: "insert" });
    }
  });

  it("consultora-qa: los dos títulos normalizan igual (es lo que disparó la fusión) y aun así no se fusionan", () => {
    const c = regressions.cases.find((x) => x.id === "consultora-qa-2026-09-18")!;
    expect(titleTokens(c.a.title)).toEqual(titleTokens(c.b.title));
    const r = dedup(asCandidate(c.b), [asRecent(c.a)]);
    expect(r.kind).toBe("insert");
  });
});
