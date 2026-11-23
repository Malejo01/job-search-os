import { describe, expect, it } from "vitest";
import {
  filterPlanRows,
  parsePlanFilter,
  parseRejectReason,
  REJECT_REASON_MAX_LENGTH,
  type PlanListRow,
} from "./plan-admin-queue";

const NOW = new Date("2026-11-23T12:00:00Z");
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000);
const row = (email: string, until: Date | null, plan = "lista"): PlanListRow => ({
  email,
  plan,
  planSource: "pago",
  planUntil: until,
});

const ROWS = [
  row("ana@example.com", day(3)),
  row("beto@example.com", day(20)),
  row("cami@example.com", day(-2)),
  row("dani@example.com", day(7)),
  row("eva@example.com", day(8)),
  row("fede@example.com", null),
];

const emails = (r: PlanListRow[]) => r.map((x) => x.email);

describe("parseRejectReason", () => {
  it("recorta y acepta un motivo corto", () => {
    expect(parseRejectReason("  No vimos el pago  ")).toEqual({
      ok: true,
      value: "No vimos el pago",
    });
  });
  it("rechaza vacío, solo espacios y lo que no es texto", () => {
    for (const bad of ["", "   ", null, undefined, 5]) {
      expect(parseRejectReason(bad)).toEqual({ ok: false, error: "motivo" });
    }
  });
  it("acota el largo a 200", () => {
    expect(REJECT_REASON_MAX_LENGTH).toBe(200);
    expect(parseRejectReason("a".repeat(200)).ok).toBe(true);
    expect(parseRejectReason("a".repeat(201))).toEqual({ ok: false, error: "motivo" });
  });
});

describe("parsePlanFilter", () => {
  it("acepta los tres filtros y todo lo demás es «sin filtro»", () => {
    expect(parsePlanFilter("vencen_7")).toBe("vencen_7");
    expect(parsePlanFilter("vencidos")).toBe("vencidos");
    expect(parsePlanFilter("pendientes")).toBe("pendientes");
    for (const other of ["", "todos", "VENCIDOS", null, undefined, 3]) {
      expect(parsePlanFilter(other)).toBeNull();
    }
  });
});

describe("filterPlanRows", () => {
  const base = { now: NOW, pendingEmails: new Set<string>() };

  it("sin búsqueda ni filtro devuelve todo en el mismo orden", () => {
    expect(emails(filterPlanRows(ROWS, { ...base, q: "", filter: null }))).toEqual(emails(ROWS));
  });

  it("busca por email sin importar mayúsculas ni espacios", () => {
    expect(emails(filterPlanRows(ROWS, { ...base, q: "  ANA@", filter: null }))).toEqual([
      "ana@example.com",
    ]);
    expect(emails(filterPlanRows(ROWS, { ...base, q: "example.com", filter: null }))).toHaveLength(
      6,
    );
    expect(filterPlanRows(ROWS, { ...base, q: "nadie", filter: null })).toEqual([]);
  });

  it("«Vencen en 7 días»: de ahora hasta 7 días inclusive, sin los vencidos ni los sin fecha", () => {
    expect(emails(filterPlanRows(ROWS, { ...base, q: "", filter: "vencen_7" }))).toEqual([
      "ana@example.com",
      "dani@example.com",
    ]);
  });

  it("«Vencidos»: la fecha ya pasó", () => {
    expect(emails(filterPlanRows(ROWS, { ...base, q: "", filter: "vencidos" }))).toEqual([
      "cami@example.com",
    ]);
  });

  it("«Pendientes»: solo quienes tienen un aviso pendiente (por email, sin importar mayúsculas)", () => {
    const pendingEmails = new Set(["beto@example.com", "otra@example.com"]);
    expect(
      emails(filterPlanRows(ROWS, { now: NOW, pendingEmails, q: "", filter: "pendientes" })),
    ).toEqual(["beto@example.com"]);
  });

  it("combina búsqueda y filtro", () => {
    expect(emails(filterPlanRows(ROWS, { ...base, q: "dani", filter: "vencen_7" }))).toEqual([
      "dani@example.com",
    ]);
    expect(filterPlanRows(ROWS, { ...base, q: "beto", filter: "vencidos" })).toEqual([]);
  });
});
