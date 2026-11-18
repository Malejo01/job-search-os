import type { CvIssue } from "@job-search-os/pipeline";
import { describe, expect, it } from "vitest";
import { CV_COACH_ISSUES_TTL_MS, signCvCoachIssues, verifyCvCoachIssues } from "./sign";

const SECRET = "secreto-de-prueba-que-no-es-real";
const USER = "00000000-0000-4000-8000-0000000c0c01";
const FLOW = "0123456789ab";
const NOW = Date.parse("2026-11-17T12:00:00Z");

const issues: CvIssue[] = [
  {
    id: "iss:1",
    type: "brecha_con_puesto",
    ref: { section: "skills", itemId: "power-bi", field: null },
    quote: null,
    skillSlug: "power-bi",
    severity: "alta",
    source: "data",
  },
  {
    id: "iss:2",
    type: "logro_sin_resultado",
    ref: {
      section: "experience",
      itemId: "0b3f2c4e-1111-4222-8333-000000000001",
      field: "bullets",
    },
    quote: "Armé reportes",
    skillSlug: null,
    severity: "media",
    source: "model",
  },
];

const sign = () =>
  signCvCoachIssues(SECRET, USER, { flowId: FLOW, target: "Analista de datos", issues }, NOW)!;
const verify = (
  raw: unknown,
  over: { user?: string; flowId?: string; nowMs?: number; secret?: string } = {},
) =>
  verifyCvCoachIssues(over.secret ?? SECRET, over.user ?? USER, raw, {
    flowId: over.flowId ?? FLOW,
    nowMs: over.nowMs ?? NOW,
  });
/** Lo que hace el navegador: JSON de ida y vuelta (sessionStorage). */
const roundTrip = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

describe("lista de problemas firmada (ADR-038 §8)", () => {
  it("firma y verifica después de pasar por el navegador; vence a las 2 h", () => {
    const signed = sign();
    expect(signed.expiresAt).toBe(Math.floor((NOW + CV_COACH_ISSUES_TTL_MS) / 1000));
    expect(verify(roundTrip(signed))).toEqual(signed);
    expect(verify(signed, { nowMs: NOW + CV_COACH_ISSUES_TTL_MS - 1000 })).not.toBeNull();
    expect(verify(signed, { nowMs: NOW + CV_COACH_ISSUES_TTL_MS + 1000 })).toBeNull();
  });

  it("el orden de las claves no importa (JSON canónico)", () => {
    const signed = sign();
    const reordered = {
      mac: signed.mac,
      // claves en otro orden: lo que pasa si el navegador reconstruye los objetos
      issues: signed.issues.map((i) => ({
        source: i.source,
        severity: i.severity,
        skillSlug: i.skillSlug,
        quote: i.quote,
        ref: { field: i.ref.field, itemId: i.ref.itemId, section: i.ref.section },
        type: i.type,
        id: i.id,
      })),
      target: signed.target,
      expiresAt: signed.expiresAt,
      flowId: signed.flowId,
      v: 1,
    };
    expect(verify(reordered)).not.toBeNull();
  });

  it("lista alterada en el navegador → no verifica", () => {
    const signed = sign();
    const tamper: ((s: typeof signed) => unknown)[] = [
      (s) => ({ ...s, issues: s.issues.slice(1) }),
      (s) => ({ ...s, issues: [...s.issues].reverse() }),
      (s) => ({ ...s, issues: s.issues.map((i) => ({ ...i, severity: "baja" })) }),
      (s) => ({ ...s, issues: s.issues.map((i) => ({ ...i, quote: "Lideré 40 personas" })) }),
      (s) => ({ ...s, target: "Gerente general" }),
      (s) => ({ ...s, expiresAt: s.expiresAt + 3600 }),
      (s) => ({ ...s, mac: `${s.mac.slice(0, -1)}${s.mac.endsWith("A") ? "B" : "A"}` }),
      // una clave de más: el esquema es estricto
      (s) => ({ ...s, extra: 1 }),
    ];
    for (const t of tamper) expect(verify(roundTrip(t(signed)))).toBeNull();
  });

  it("atada a la persona, a la charla y al secreto", () => {
    const signed = sign();
    expect(verify(signed, { user: "00000000-0000-4000-8000-0000000c0c02" })).toBeNull();
    expect(verify(signed, { flowId: "ba9876543210" })).toBeNull();
    expect(verify(signed, { secret: "otro-secreto-de-prueba" })).toBeNull();
  });

  it("sin AUTH_SECRET no se firma ni se acepta", () => {
    expect(
      signCvCoachIssues(undefined, USER, { flowId: FLOW, target: "T", issues }, NOW),
    ).toBeNull();
    expect(verify(sign(), { secret: "" })).toBeNull();
  });

  it("basura del navegador → null, nunca lanza", () => {
    for (const raw of [null, undefined, "x", 1, [], {}, { v: 1 }]) expect(verify(raw)).toBeNull();
  });
});
