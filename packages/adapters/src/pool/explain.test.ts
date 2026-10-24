import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildHintsReport,
  classifyWhy,
  explainDatabaseUrl,
  firstToLlm,
  formatExplainReport,
  formatHintsReport,
  formatPicksTable,
  hintsCrossRoles,
  parseExplainArgs,
  parsePersona,
  TITLE_WIDTH,
  type ExplainReport,
  type HintsRow,
  type WhyContext,
  type WhyRow,
} from "./explain";
import type { PublicJobRow, RankedPick } from "./select";

const UID = "a0000000-0000-4000-8000-0000000000a1";
const NOW = new Date("2026-10-15T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

describe("parseExplainArgs", () => {
  it("persona con valores por defecto", () => {
    const r = parseExplainArgs(["--persona", "p.json"]);
    expect(r).toEqual({
      ok: true,
      args: { mode: { kind: "persona", path: "p.json" }, limit: 30, db: "snapshot", why: [] },
    });
  });

  it("user, límite, base dev y --why repetido; ignora el -- de pnpm", () => {
    const r = parseExplainArgs([
      "--",
      "--user",
      UID,
      "--limit",
      "10",
      "--db",
      "dev",
      "--why",
      "data analyst",
      "--why",
      "fraud",
    ]);
    expect(r).toEqual({
      ok: true,
      args: {
        mode: { kind: "user", userId: UID },
        limit: 10,
        db: "dev",
        why: ["data analyst", "fraud"],
      },
    });
  });

  it("--hints es válido sin persona ni usuario", () => {
    expect(parseExplainArgs(["--hints"])).toEqual({
      ok: true,
      args: { mode: { kind: "hints" }, limit: 30, db: "snapshot", why: [] },
    });
    const r = parseExplainArgs(["--", "--hints", "--db", "dev"]);
    expect(r).toMatchObject({ ok: true, args: { mode: { kind: "hints" }, db: "dev" } });
  });

  it.each([
    [["--hints", "--persona", "p.json"], "--hints"],
    [["--hints", "--user", UID], "--hints"],
    [["--hints", "--why", "x"], "--hints"],
    [[], "exactamente uno"],
    [["--persona", "p.json", "--user", UID], "exactamente uno"],
    [["--user", "no-es-uuid"], "uuid"],
    [["--persona", "p.json", "--db", "prod"], "--db"],
    [["--persona", "p.json", "--db", "cloud"], "--db"],
    [["--persona", "p.json", "--limit", "0"], "--limit"],
    [["--persona", "p.json", "--limit", "9999"], "--limit"],
    [["--persona", "p.json", "--limit", "1e2"], "--limit"],
    [["--persona", "p.json", "--url", "postgres://x"], "desconocido"],
    [["--persona"], "valor"],
    [["--persona", "p.json", "--why"], "valor"],
  ])("rechaza %j", (argv, fragment) => {
    const r = parseExplainArgs(argv);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain(fragment);
  });
});

describe("explainDatabaseUrl", () => {
  const local = "postgres://postgres:postgres@localhost:54322/jobsearch";

  it("cambia solo el nombre de la base según --db", () => {
    expect(explainDatabaseUrl(local, "snapshot")).toEqual({
      ok: true,
      url: "postgres://postgres:postgres@localhost:54322/jobsearch_snapshot",
    });
    expect(explainDatabaseUrl(local, "dev")).toEqual({
      ok: true,
      url: "postgres://postgres:postgres@localhost:54322/jobsearch",
    });
  });

  it("acepta 127.0.0.1 y descarta parámetros de la URL", () => {
    const r = explainDatabaseUrl(
      "postgres://u:p@127.0.0.1:5432/x?host=ejemplo.com&sslmode=require",
      "dev",
    );
    expect(r).toEqual({ ok: true, url: "postgres://u:p@127.0.0.1:5432/jobsearch" });
  });

  it.each([
    "postgres://u:p@db.example.com:5432/x",
    "postgres://u:p@10.0.0.5:5432/x",
    "postgres://u:p@localhost.example.com:5432/x",
    "postgres://u:p@[::1]:5432/x",
    "no es una url",
    "",
  ])("falla cerrado con %j", (base) => {
    const r = explainDatabaseUrl(base, "snapshot");
    expect(r.ok).toBe(false);
  });
});

describe("parsePersona", () => {
  const base = {
    targetRoles: ["data_analyst"],
    locationCountry: "ar",
    remoteOnly: true,
    yearsTotal: 3,
    skills: [{ slug: "sql", level: 2 }],
  };

  it("normaliza el país y completa lo opcional con null", () => {
    const r = parsePersona(base);
    expect(r).toEqual({
      ok: true,
      persona: {
        targetRoles: ["data_analyst"],
        locationCountry: "AR",
        remoteOnly: true,
        yearsTotal: 3,
        salaryFloorUsd: null,
        maxWeeklyHours: null,
        jobLanguages: null,
        skills: [{ slug: "sql", level: 2 }],
      },
    });
  });

  it("acepta jobLanguages y lo devuelve", () => {
    const r = parsePersona({ ...base, jobLanguages: ["es"] });
    expect(r.ok && r.persona.jobLanguages).toEqual(["es"]);
    const r2 = parsePersona({ ...base, jobLanguages: ["es", "en"] });
    expect(r2.ok && r2.persona.jobLanguages).toEqual(["es", "en"]);
  });

  it("sin jobLanguages devuelve null", () => {
    const r = parsePersona(base);
    expect(r.ok && r.persona.jobLanguages).toBeNull();
  });

  it.each([[[]], [["fr"]], [["es", "fr"]]])("rechaza jobLanguages %j", (jl) => {
    expect(parsePersona({ ...base, jobLanguages: jl }).ok).toBe(false);
  });

  it.each([
    { ...base, targetRoles: ["inventado"] },
    { ...base, targetRoles: [] },
    { ...base, locationCountry: "XX" },
    { ...base, skills: [{ slug: "sql", level: 4 }] },
    { ...base, extra: 1 },
    { ...base, yearsTotal: -1 },
  ])("rechaza una persona inválida", (bad) => {
    expect(parsePersona(bad).ok).toBe(false);
  });

  it("las personas incluidas son válidas", () => {
    for (const f of [
      "lucia.json",
      "ai-junior.json",
      "product-manager.json",
      "product-owner.json",
      "project-manager.json",
      "product-marketing.json",
      "data-engineer.json",
      "solutions-engineer.json",
      "ventas-b2b.json",
      "atencion-cliente.json",
      "finanzas-contabilidad.json",
      "asistencia-operaciones.json",
      "marketing-digital.json",
      "backend-dev.json",
      "qa.json",
      "diseno-ux.json",
      "rrhh-it.json",
      "customer-success-solo-es.json",
    ]) {
      const json = JSON.parse(readFileSync(new URL(`./personas/${f}`, import.meta.url), "utf8"));
      expect(parsePersona(json).ok, f).toBe(true);
    }
  });
});

describe("--hints (ronda 97)", () => {
  const rows: HintsRow[] = [
    {
      sourceKind: "wwr",
      title: "Senior Scrum Master Zafiro",
      tags: null,
      categories: ["remote-product-jobs"],
      roleHints: ["producto_proyectos"],
    },
    {
      sourceKind: "other",
      title: "Product Marketing Manager Opalo",
      tags: null,
      categories: null,
      roleHints: [],
    },
    {
      sourceKind: "other",
      title: "Product Owner Jade",
      tags: null,
      categories: null,
      roleHints: ["producto_proyectos"],
    },
  ];

  it("cuenta lo guardado, lo recalculado y a qué se traduce la clave anterior", () => {
    const r = buildHintsReport(rows);
    expect(r.total).toBe(3);
    const by = (role: string) => r.byRole.find((x) => x.role === role);
    expect(by("producto_proyectos")).toEqual({
      role: "producto_proyectos",
      stored: 2,
      recomputed: 0,
    });
    expect(by("product_owner")).toEqual({ role: "product_owner", stored: 0, recomputed: 2 });
    expect(by("product_marketing")).toEqual({
      role: "product_marketing",
      stored: 0,
      recomputed: 1,
    });
    expect(r.legacyMatrix).toEqual([
      { from: "producto_proyectos", to: "product_manager,product_owner,project_manager", count: 1 },
      { from: "producto_proyectos", to: "product_owner", count: 1 },
    ]);
  });

  it("una clave guardada que no es conocida no se imprime", () => {
    const text = formatHintsReport(
      buildHintsReport([
        {
          sourceKind: "other",
          title: "Cargo",
          tags: null,
          categories: null,
          roleHints: ["clave_rara"],
        },
      ]),
    );
    expect(text).not.toContain("clave_rara");
  });

  it("el formateo no imprime títulos", () => {
    const text = formatHintsReport(buildHintsReport(rows));
    for (const t of ["Zafiro", "Opalo", "Jade", "Scrum", "Product Owner"]) {
      expect(text).not.toContain(t);
    }
    expect(text).toContain("carrera");
    expect(text).toContain("producto_proyectos → combinación nueva");
  });
});

describe("--hints (ronda 106)", () => {
  it("las carreras nuevas aparecen en la tabla, con 0 guardadas y lo recalculado", () => {
    const rows: HintsRow[] = [
      {
        sourceKind: "other",
        title: "Senior Data Engineer Cuarzo",
        tags: null,
        categories: null,
        roleHints: [],
      },
      {
        sourceKind: "other",
        title: "Solutions Architect Berilo",
        tags: null,
        categories: null,
        roleHints: [],
      },
      {
        sourceKind: "other",
        title: "Site Reliability Engineer Onix",
        tags: null,
        categories: null,
        roleHints: [],
      },
    ];
    const r = buildHintsReport(rows);
    const by = (role: string) => r.byRole.find((x) => x.role === role);
    expect(by("data_engineer")).toEqual({ role: "data_engineer", stored: 0, recomputed: 1 });
    expect(by("solutions_engineer")).toEqual({
      role: "solutions_engineer",
      stored: 0,
      recomputed: 1,
    });
    expect(by("soporte_it")).toMatchObject({ recomputed: 1 });
  });
});

describe("--hints (ronda 107)", () => {
  it("ventas y atención aparecen en la tabla con lo recalculado", () => {
    const row = (title: string, categories: string[] | null = null): HintsRow => ({
      sourceKind: categories ? "getonboard_api" : "other",
      title,
      tags: null,
      categories,
      roleHints: [],
    });
    const r = buildHintsReport([
      row("Account Executive Cuarzo"),
      row("Sales Development Representative Berilo"),
      row("Customer Support Specialist Onix", ["customer-support"]),
      row("Cargo sin pistas Jade", ["sales"]),
    ]);
    const by = (role: string) => r.byRole.find((x) => x.role === role);
    expect(by("ventas_b2b")).toEqual({ role: "ventas_b2b", stored: 0, recomputed: 3 });
    expect(by("atencion_cliente")).toEqual({ role: "atencion_cliente", stored: 0, recomputed: 1 });
    expect(by("customer_success")).toMatchObject({ recomputed: 1 });
  });
});

describe("classifyWhy", () => {
  const row = (over: Partial<WhyRow> = {}): WhyRow => ({
    dedupOfId: null,
    lastSeenAt: daysAgo(1),
    postedAt: daysAgo(2),
    roleHints: ["data_analyst"],
    ...over,
  });
  const ctx = (over: Partial<WhyContext> = {}): WhyContext => ({
    roles: ["data_analyst"],
    now: NOW,
    limit: 30,
    owned: false,
    inCandidates: true,
    discarded: null,
    rank: 5,
    ...over,
  });

  it("cada paso, en orden", () => {
    expect(classifyWhy(row({ dedupOfId: UID }), ctx()).step).toBe("copia");
    expect(classifyWhy(row({ lastSeenAt: daysAgo(15) }), ctx()).step).toBe("last_seen");
    expect(classifyWhy(row({ postedAt: daysAgo(31) }), ctx()).step).toBe("posted");
    expect(classifyWhy(row({ roleHints: ["qa"] }), ctx()).step).toBe("hints");
    expect(classifyWhy(row(), ctx({ owned: true })).step).toBe("ya_la_tiene");
    expect(classifyWhy(row(), ctx({ inCandidates: false })).step).toBe("tope");
    const pre = classifyWhy(
      row(),
      ctx({ discarded: { reason: "titulo_blocklist", detail: "director" } }),
    );
    expect(pre.step).toBe("prefiltro");
    expect(pre.text).toContain("titulo_blocklist");
    expect(classifyWhy(row(), ctx({ rank: 31 })).step).toBe("ranking");
    expect(classifyWhy(row(), ctx({ rank: 30 }))).toEqual({
      step: "entro",
      text: "ENTRÓ en la posición 30",
    });
  });

  it("ubicación y nivel son pasos propios, no 'prefiltro'", () => {
    const place = classifyWhy(
      row(),
      ctx({ discarded: { reason: "ubicacion", detail: "habilita solo US, no AR" } }),
    );
    expect(place.step).toBe("ubicacion");
    expect(place.text).toContain("habilita solo US");
    expect(classifyWhy(row(), ctx({ discarded: { reason: "nivel", detail: "staff" } })).step).toBe(
      "nivel",
    );
  });

  it("en los ATS la ventana es last_seen_at: un posted_at viejo no los saca", () => {
    for (const sourceKind of ["greenhouse", "lever", "ashby"]) {
      expect(classifyWhy(row({ sourceKind, postedAt: daysAgo(90) }), ctx()).step).toBe("entro");
    }
    expect(classifyWhy(row({ sourceKind: "remoteok", postedAt: daysAgo(90) }), ctx()).step).toBe(
      "posted",
    );
    expect(
      classifyWhy(row({ sourceKind: "greenhouse", lastSeenAt: daysAgo(15) }), ctx()).step,
    ).toBe("last_seen");
  });

  it("el detalle del ranking trae fit, nivel y score", () => {
    const r = classifyWhy(
      row(),
      ctx({
        rank: 51,
        rankInfo: { titleFit: 1, seniorPenalty: 1, level: "senior", score: 6.5 },
      }),
    );
    expect(r.step).toBe("ranking");
    expect(r.text).toContain("fit 1, nivel senior penalizado, score 6.5");
  });

  it("sin fecha de publicación no queda afuera por la ventana", () => {
    expect(classifyWhy(row({ postedAt: null }), ctx()).step).toBe("entro");
  });

  it("la primera causa gana cuando hay varias", () => {
    const r = row({ dedupOfId: UID, lastSeenAt: daysAgo(40) });
    expect(classifyWhy(r, ctx({ owned: true })).step).toBe("copia");
  });

  it("sin puesto, solo cuentan los hints IT; sin hints siempre cruza", () => {
    expect(hintsCrossRoles([], ["qa"])).toBe(true);
    expect(hintsCrossRoles(["marketing_digital"], [])).toBe(false);
    expect(hintsCrossRoles(["backend", "marketing_digital"], [])).toBe(true);
    expect(hintsCrossRoles(["backend"], ["qa", "data_analyst"])).toBe(false);
  });
});

function pick(rank: number, over: Partial<PublicJobRow> = {}, extra: Partial<RankedPick> = {}) {
  return {
    row: {
      sourceKind: "remoteok",
      title: `Analista ficticio ${rank}`,
      locationRaw: "Remoto",
      roleHints: ["data_analyst"],
      jdText: "Descripción ficticia",
      ...over,
    } as PublicJobRow,
    flags: ["location_risk"],
    matchedRole: "data_analyst",
    score: 7.5,
    exactRole: true,
    titleFit: 2,
    seniorPenalty: 0,
    level: null,
    rank,
    ...extra,
  } satisfies RankedPick;
}

describe("formato", () => {
  it("la tabla corta título y ubicación y alinea las columnas", () => {
    const long = "T".repeat(100);
    const lines = formatPicksTable([
      pick(1, { title: long, locationRaw: "L".repeat(80) }),
      pick(2, { roleHints: [] }, { exactRole: false, flags: [] }),
    ]);
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain("T".repeat(TITLE_WIDTH));
    expect(lines[1]).not.toContain("T".repeat(TITLE_WIDTH + 1));
    expect(lines[1]).toContain("L".repeat(40));
    expect(lines[1]).not.toContain("L".repeat(41));
    expect(lines[0]).toMatch(
      /^rank\s+fuente\s+título\s+ubicación\s+hints\s+exacto\s+fit\s+nivel\s+score\s+flags\s+JD$/,
    );
    expect(lines[1]).toContain("7.5");
    expect(lines[2]).toMatch(/\bno\b.*\s-\s+sí$/);
  });

  it("firstToLlm toma las primeras n con JD, en orden", () => {
    const picks = [pick(1, { jdText: null }), pick(2), pick(3, { jdText: "  " }), pick(4), pick(5)];
    expect(firstToLlm(picks, 2)).toEqual([2, 4]);
    expect(firstToLlm(picks, 9)).toEqual([2, 4, 5]);
  });

  it("el informe no imprime el user_id y resume descartes y --why", () => {
    const report: ExplainReport = {
      header: "perfil: cuenta existente · puestos: data_analyst",
      warnings: ["skill desconocida en la taxonomía: inventada"],
      limit: 30,
      candidateCount: 120,
      discardedByReason: [
        ["titulo_blocklist", 5],
        ["disciplina_distinta", 2],
      ],
      picks: [pick(1)],
      firstEvalTopN: 9,
      why: [
        {
          pattern: "data analyst",
          matches: [{ title: "Data Analyst", source: "ashby", step: "tope", text: "x" }],
        },
        { pattern: "(", matches: [], error: "la expresión regular no es válida" },
      ],
    };
    const text = formatExplainReport(report);
    expect(text).not.toContain(UID);
    expect(text).toContain("candidatas de la consulta: 120 (tope 300)");
    expect(text).toContain("titulo_blocklist=5, disciplina_distinta=2");
    expect(text).toContain("aviso: skill desconocida");
    expect(text).toContain("irían primero al LLM (las 9 primeras con JD): #1");
    expect(text).toContain('--why "data analyst":');
    expect(text).toContain("[tope] Data Analyst (ashby): x");
    expect(text).toContain("la expresión regular no es válida");
  });
});
