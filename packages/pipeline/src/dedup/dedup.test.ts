import { describe, expect, it } from "vitest";
import golden from "../../../../evals/fixtures/golden.json";
import { normalizeCompany } from "../normalize/company";
import { titleTokens } from "../normalize/title";
import { dedup, type DedupCandidate, type RecentJob } from "./dedup";
import { textShingles } from "./similarity";

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

  it("misma empresa + Jaccard de título ≥ 0.6 dentro de 14 días → merge por company_title", () => {
    const similar: GoldenJob = { ...acme, titulo: "Senior AI Engineer (Remote)" };
    const r = dedup(candidateFrom(similar), [recent]);
    expect(r).toMatchObject({ kind: "merge", jobId: "job-900", reason: "company_title" });
  });

  it("misma empresa, título similar, pero fuera de la ventana de 14 días → insert", () => {
    const old: RecentJob = { ...recent, firstSeenAt: "2026-08-01T12:00:00Z" };
    expect(dedup(candidateFrom(acme), [old])).toEqual({ kind: "insert" });
  });

  it("otra empresa con el mismo título → insert", () => {
    const other: GoldenJob = { ...acme, empresa: "Globex" };
    expect(dedup(candidateFrom(other), [recent])).toEqual({ kind: "insert" });
  });

  it("sin jobs recientes → insert; elige el más similar si hay varios candidatos", () => {
    expect(dedup(candidateFrom(acme), [])).toEqual({ kind: "insert" });
    const weaker: RecentJob = {
      ...recent,
      id: "job-901",
      titleTokens: ["ai", "engineer", "platform", "cloud"],
    };
    const r = dedup(candidateFrom(acme), [weaker, recent]);
    expect(r).toMatchObject({ kind: "merge", jobId: "job-900" });
  });
});
