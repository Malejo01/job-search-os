import { describe, expect, it } from "vitest";
import type { CvCoachBefore, CvIssue } from "../schemas";
import { diffCv, type CvDiffItem } from "./diff";

// Todo inventado: «Empresa A», «Proyecto 1».
const FLOW = "0123456789ab";
const JOB = "0b3f2c4e-1111-4222-8333-000000000001";
const OLD = "0b3f2c4e-1111-4222-8333-000000000002";
const PROJECT = "0b3f2c4e-1111-4222-8333-000000000003";

const before: CvCoachBefore = {
  flowId: FLOW,
  items: [
    {
      historyId: JOB,
      kind: "trabajo",
      organization: "Empresa A",
      title: "Analista",
      bullets: ["Responsable de reportes", "Armé tableros de ventas"],
    },
    {
      historyId: OLD,
      kind: "trabajo",
      organization: "Empresa B",
      title: "Asistente",
      bullets: ["Ordené la facturación"],
    },
  ],
};

const after: CvDiffItem[] = [
  {
    historyId: JOB,
    kind: "trabajo",
    organization: "Empresa A",
    title: "Analista",
    bullets: ["Armé tableros de ventas", "Reduje de 3 días a 1 el cierre de reportes semanales"],
  },
  {
    historyId: OLD,
    kind: "trabajo",
    organization: "Empresa B",
    title: "Asistente",
    bullets: ["Ordené la facturación"],
  },
  {
    historyId: PROJECT,
    kind: "proyecto",
    organization: "Proyecto 1",
    title: "Desarrollador",
    bullets: ["Buscador de eventos con mapa"],
  },
];

const issue = (id: string, over: Partial<CvIssue> = {}): CvIssue => ({
  id,
  type: "logro_sin_resultado",
  ref: { section: "experience", itemId: JOB, field: "bullets" },
  quote: null,
  skillSlug: null,
  severity: "alta",
  source: "model",
  ...over,
});

const issues: CvIssue[] = [
  issue("iss:1", { quote: "Responsable de reportes" }),
  issue("iss:2", {
    type: "brecha_con_puesto",
    ref: { section: "skills", itemId: "sql", field: null },
    skillSlug: "sql",
    source: "data",
  }),
  issue("iss:3", {
    type: "fecha_faltante",
    ref: { section: "experience", itemId: OLD, field: "dates" },
  }),
];

describe("diffCv: qué mejoró", () => {
  it("viñetas lado a lado: antes, después, agregadas y quitadas; ítems nuevos marcados", () => {
    const d = diffCv({
      flowId: FLOW,
      before,
      after,
      issues,
      progress: { resolved: [], skipped: [] },
    });
    expect(d.hasBefore).toBe(true);
    const job = d.items.find((i) => i.historyId === JOB)!;
    expect(job).toMatchObject({
      before: ["Responsable de reportes", "Armé tableros de ventas"],
      after: ["Armé tableros de ventas", "Reduje de 3 días a 1 el cierre de reportes semanales"],
      added: ["Reduje de 3 días a 1 el cierre de reportes semanales"],
      removed: ["Responsable de reportes"],
      status: "changed",
    });
    expect(d.items.find((i) => i.historyId === OLD)?.status).toBe("same");
    expect(d.items.find((i) => i.historyId === PROJECT)).toMatchObject({
      status: "new",
      before: [],
    });
    // solo lo que cambió va primero
    expect(d.items.map((i) => i.status)).toEqual(["changed", "new", "same"]);
  });

  it("un ítem que estaba antes y ya no está figura como quitado, con el texto de la foto", () => {
    const d = diffCv({
      flowId: FLOW,
      before,
      after: after.filter((i) => i.historyId !== OLD),
      issues,
      progress: { resolved: [], skipped: [] },
    });
    expect(d.items.find((i) => i.historyId === OLD)).toMatchObject({
      status: "removed",
      before: ["Ordené la facturación"],
      after: [],
    });
  });

  it("problemas resueltos, salteados y abiertos según el avance (ids desconocidos se ignoran)", () => {
    const d = diffCv({
      flowId: FLOW,
      before,
      after,
      issues,
      progress: { resolved: ["iss:1", "iss:9"], skipped: ["iss:3", "iss:1"] },
    });
    expect(d.issues.resolved.map((i) => i.id)).toEqual(["iss:1"]);
    expect(d.issues.skipped.map((i) => i.id)).toEqual(["iss:3"]);
    expect(d.issues.open.map((i) => i.id)).toEqual(["iss:2"]);
  });

  it("sin la foto «antes» (o de otra charla) solo muestra los problemas", () => {
    for (const b of [null, { ...before, flowId: "ba9876543210" }]) {
      const d = diffCv({
        flowId: FLOW,
        before: b,
        after,
        issues,
        progress: { resolved: ["iss:1"], skipped: [] },
      });
      expect(d.hasBefore).toBe(false);
      expect(d.items).toEqual([]);
      expect(d.issues.resolved.map((i) => i.id)).toEqual(["iss:1"]);
    }
  });

  it("nunca muestra texto que no esté en la base o en la foto: una cita ajena queda sin cita", () => {
    const d = diffCv({
      flowId: FLOW,
      before,
      after,
      issues: [
        issue("iss:1", { quote: "Lideré un equipo de 40 personas" }),
        issue("iss:2", { quote: "responsable   DE reportes" }),
      ],
      progress: { resolved: [], skipped: [] },
    });
    expect(d.issues.open.map((i) => i.quote)).toEqual([null, "responsable DE reportes"]);
    // las viñetas salen tal cual de la foto o de la base
    const all = d.items.flatMap((i) => [...i.before, ...i.after]);
    const sources = new Set([...before.items, ...after].flatMap((i) => i.bullets));
    for (const b of all) expect(sources.has(b)).toBe(true);
  });

  it("los títulos salen de la base; si el ítem ya no está, de la foto", () => {
    const renamed = after.map((i) =>
      i.historyId === JOB ? { ...i, title: "Analista de datos" } : i,
    );
    const d = diffCv({
      flowId: FLOW,
      before,
      after: renamed,
      issues: [],
      progress: { resolved: [], skipped: [] },
    });
    expect(d.items.find((i) => i.historyId === JOB)?.title).toBe("Analista de datos");
  });
});
