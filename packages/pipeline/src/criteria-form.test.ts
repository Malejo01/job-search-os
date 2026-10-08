import { describe, expect, it } from "vitest";
import { criteriaFormDefaults, parseCriteriaForm } from "./criteria-form";
import type { CriteriaRules } from "./criteria";
import { DEFAULT_CRITERIA_RULES } from "./onboarding";

type Raw = Parameters<typeof parseCriteriaForm>[0];

/** Formulario tal como llegaría sin tocar nada. */
function untouched(current: CriteriaRules): Raw {
  return { ...criteriaFormDefaults(current) };
}

const BASE = DEFAULT_CRITERIA_RULES;

describe("parseCriteriaForm", () => {
  it("enviar el formulario sin cambios devuelve las mismas reglas", () => {
    const r = parseCriteriaForm(untouched(BASE), BASE);
    expect(r).toEqual({ ok: true, rules: BASE });
  });

  it("conserva lo que no se edita, incluso con reglas que no son las de defecto", () => {
    const current: CriteriaRules = {
      ...BASE,
      title_cap_score: 2,
      years_gap: { risk_from: null, penalty_from: 3, penalty: 1, blocker_from: 6 },
      ml_engineer_keywords: ["palabra a"],
      ai_eval_keywords: ["palabra b"],
      cloud_must_penalty: 0.5,
    };
    const r = parseCriteriaForm({ ...untouched(current), max_years_hard: "10" }, current);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rules.max_years_hard).toBe(10);
    expect(r.rules.title_cap_score).toBe(2);
    expect(r.rules.years_gap).toEqual(current.years_gap);
    expect(r.rules.ml_engineer_keywords).toEqual(["palabra a"]);
    expect(r.rules.cloud_must_penalty).toBe(0.5);
    expect(r.rules.years_penalty).toEqual(current.years_penalty);
  });

  it("no muta current", () => {
    const snapshot = structuredClone(BASE);
    parseCriteriaForm({ ...untouched(BASE), title_blocklist: "otro" }, BASE);
    expect(BASE).toEqual(snapshot);
  });

  it("listas: minúscula, recortadas, sin duplicados ni líneas vacías", () => {
    const r = parseCriteriaForm(
      { ...untouched(BASE), title_blocklist: "  Lead \r\n\nMANAGER\nlead\n  " },
      BASE,
    );
    expect(r.ok && r.rules.title_blocklist).toEqual(["lead", "manager"]);
  });

  it("listas: una entrada que no cambió conserva su forma original (espacio final de 'vp ')", () => {
    const r = parseCriteriaForm({ ...untouched(BASE), title_blocklist: "vp\nnueva" }, BASE);
    expect(r.ok && r.rules.title_blocklist).toEqual(["vp ", "nueva"]);
  });

  it("lista vacía es válida", () => {
    const r = parseCriteriaForm({ ...untouched(BASE), title_allowlist: "" }, BASE);
    expect(r.ok && r.rules.title_allowlist).toEqual([]);
  });

  it("más de 100 entradas o una de más de 60 caracteres", () => {
    const many = Array.from({ length: 101 }, (_, i) => `palabra ${i}`).join("\n");
    expect(parseCriteriaForm({ ...untouched(BASE), title_blocklist: many }, BASE)).toEqual({
      ok: false,
      field: "title_blocklist",
    });
    const hundred = Array.from({ length: 100 }, (_, i) => `palabra ${i}`).join("\n");
    expect(parseCriteriaForm({ ...untouched(BASE), title_blocklist: hundred }, BASE).ok).toBe(true);
    expect(
      parseCriteriaForm({ ...untouched(BASE), other_discipline_keywords: "x".repeat(61) }, BASE),
    ).toEqual({ ok: false, field: "other_discipline_keywords" });
    expect(
      parseCriteriaForm({ ...untouched(BASE), other_discipline_keywords: "x".repeat(60) }, BASE).ok,
    ).toBe(true);
  });

  it("caracteres de control en una entrada", () => {
    expect(parseCriteriaForm({ ...untouched(BASE), title_allowlist: "a\u0007b" }, BASE)).toEqual({
      ok: false,
      field: "title_allowlist",
    });
  });

  it("disciplinas: conjunto cerrado y al menos una", () => {
    expect(parseCriteriaForm({ ...untouched(BASE), allowed_disciplines: [] }, BASE)).toEqual({
      ok: false,
      field: "allowed_disciplines",
    });
    expect(
      parseCriteriaForm(
        { ...untouched(BASE), allowed_disciplines: ["backend", "inventada"] },
        BASE,
      ),
    ).toEqual({ ok: false, field: "allowed_disciplines" });
    const r = parseCriteriaForm(
      { ...untouched(BASE), allowed_disciplines: ["frontend", "backend", "frontend"] },
      BASE,
    );
    expect(r.ok && r.rules.allowed_disciplines).toEqual(["frontend", "backend"]);
    // un valor suelto (una sola casilla marcada) también vale
    const one = parseCriteriaForm({ ...untouched(BASE), allowed_disciplines: "data" }, BASE);
    expect(one.ok && one.rules.allowed_disciplines).toEqual(["data"]);
  });

  it("números fuera de rango, vacíos o no numéricos", () => {
    const bad: [string, string][] = [
      ["salary_floor_usd_monthly", "-1"],
      ["salary_floor_usd_monthly", "100001"],
      ["salary_floor_usd_monthly", ""],
      ["salary_floor_usd_monthly", "3000.5"],
      ["max_weekly_hours", "0"],
      ["max_weekly_hours", "81"],
      ["max_years_hard", "41"],
      ["max_years_hard", "abc"],
      ["max_years_hard", "1e1"],
    ];
    for (const [field, value] of bad) {
      expect(parseCriteriaForm({ ...untouched(BASE), [field]: value }, BASE)).toEqual({
        ok: false,
        field,
      });
    }
    const edges = parseCriteriaForm(
      {
        ...untouched(BASE),
        salary_floor_usd_monthly: "100000",
        max_weekly_hours: "1",
        max_years_hard: "1",
      },
      BASE,
    );
    expect(edges.ok).toBe(true);
    // con 0 decide() bloquearía toda oferta que declare años
    expect(parseCriteriaForm({ ...untouched(BASE), max_years_hard: "0" }, BASE)).toEqual({
      ok: false,
      field: "max_years_hard",
    });
  });

  it("riesgo de inglés: solo los valores del enum", () => {
    expect(parseCriteriaForm({ ...untouched(BASE), english_risk_from: "fluido" }, BASE)).toEqual({
      ok: false,
      field: "english_risk_from",
    });
    const r = parseCriteriaForm({ ...untouched(BASE), english_risk_from: "intermedio" }, BASE);
    expect(r.ok && r.rules.english_risk_from).toBe("intermedio");
  });

  it("umbrales desordenados, repetidos o fuera de 0 a 10", () => {
    const t = (p: string, a: string, g: string) =>
      parseCriteriaForm(
        {
          ...untouched(BASE),
          threshold_personalizado: p,
          threshold_aplicar: a,
          threshold_guardar: g,
        },
        BASE,
      );
    expect(t("7", "9", "5")).toEqual({ ok: false, field: "thresholds" });
    expect(t("9", "7", "7")).toEqual({ ok: false, field: "thresholds" });
    expect(t("9", "9", "5")).toEqual({ ok: false, field: "thresholds" });
    expect(t("11", "7", "5")).toEqual({ ok: false, field: "threshold_personalizado" });
    expect(t("9", "7", "-1")).toEqual({ ok: false, field: "threshold_guardar" });
    expect(t("9", "", "5")).toEqual({ ok: false, field: "threshold_aplicar" });
    const ok = t("10", "6.5", "0");
    expect(ok.ok && ok.rules.thresholds).toEqual({ personalizado: 10, aplicar: 6.5, guardar: 0 });
  });

  it("el error no repite el valor enviado", () => {
    const r = parseCriteriaForm({ ...untouched(BASE), max_years_hard: "valor-secreto-123" }, BASE);
    expect(JSON.stringify(r)).not.toContain("valor-secreto-123");
  });

  it("campos desconocidos se ignoran: no pisan reglas que el formulario no edita", () => {
    const r = parseCriteriaForm(
      { ...untouched(BASE), title_cap_score: "10", ml_engineer_keywords: "x" },
      BASE,
    );
    expect(r.ok && r.rules.title_cap_score).toBe(BASE.title_cap_score);
    expect(r.ok && r.rules.ml_engineer_keywords).toEqual(BASE.ml_engineer_keywords);
  });
});

describe("criteriaFormDefaults", () => {
  it("precarga cada campo editable", () => {
    const d = criteriaFormDefaults(BASE);
    expect(d.title_allowlist).toBe("agent architect");
    expect(d.title_blocklist.split("\n")).toContain("lead");
    expect(d.allowed_disciplines).toEqual(BASE.allowed_disciplines);
    expect(d.salary_floor_usd_monthly).toBe("3000");
    expect(d.max_weekly_hours).toBe("40");
    expect(d.max_years_hard).toBe("8");
    expect(d.english_risk_from).toBe("avanzado");
    expect(d.threshold_personalizado).toBe("9");
    expect(d.threshold_aplicar).toBe("7");
    expect(d.threshold_guardar).toBe("5");
  });
});
