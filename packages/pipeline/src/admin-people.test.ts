import { describe, expect, it } from "vitest";
import {
  ADMIN_HISTORY_LABELS,
  PEOPLE_FILTERS,
  PEOPLE_PAGE_SIZE,
  hasDbRole,
  historyLabel,
  parsePeopleFilter,
  parsePeoplePage,
  parsePeopleQuery,
  personActionMessage,
  personBadges,
  withDbTesters,
} from "./admin-people";

const NOW = new Date("2026-12-10T12:00:00Z");
const base = {
  blockedAt: null,
  isTest: false,
  onboarded: true,
  plan: "gratis",
  planUntil: null,
  planSource: null,
  isAdmin: false,
  isTester: false,
};

describe("filtros y búsqueda del listado (ADM-1)", () => {
  it("acepta solo filtros conocidos y cae en «todas»", () => {
    expect(parsePeopleFilter("vencen_7")).toBe("vencen_7");
    expect(parsePeopleFilter("bloqueadas")).toBe("bloqueadas");
    expect(parsePeopleFilter("drop table")).toBe("todas");
    expect(parsePeopleFilter(undefined)).toBe("todas");
    expect(parsePeopleFilter(["testers", "admins"])).toBe("testers");
    expect(PEOPLE_FILTERS.map((f) => f.key)).toContain("sin_onboarding");
    expect(new Set(PEOPLE_FILTERS.map((f) => f.key)).size).toBe(PEOPLE_FILTERS.length);
  });

  it("la página es un entero de 1 en adelante, con tope", () => {
    expect(parsePeoplePage("3")).toBe(3);
    expect(parsePeoplePage("0")).toBe(1);
    expect(parsePeoplePage("-2")).toBe(1);
    expect(parsePeoplePage("abc")).toBe(1);
    expect(parsePeoplePage("2.5")).toBe(1);
    expect(parsePeoplePage("100000")).toBe(1000);
    expect(PEOPLE_PAGE_SIZE).toBe(50);
  });

  it("la búsqueda se recorta y tiene tope de largo", () => {
    expect(parsePeopleQuery("  ana@x.com ")).toBe("ana@x.com");
    expect(parsePeopleQuery("")).toBeNull();
    expect(parsePeopleQuery(undefined)).toBeNull();
    expect(parsePeopleQuery("x".repeat(300))!.length).toBe(120);
  });
});

describe("estado de una persona en el panel", () => {
  it("bloqueada va primero y en rojo", () => {
    const b = personBadges({ ...base, blockedAt: new Date("2026-12-01") }, NOW);
    expect(b[0]).toEqual({ key: "bloqueada", label: "Bloqueada", tone: "danger" });
  });

  it("plan: gratis, activo, por vencer, vencido y becado", () => {
    expect(personBadges(base, NOW).map((b) => b.key)).toContain("gratis");
    const activo = personBadges(
      { ...base, plan: "lista", planUntil: new Date("2027-01-30"), planSource: "pago" },
      NOW,
    );
    expect(activo.find((b) => b.key === "activo")?.label).toBe("Plan activo");
    const porVencer = personBadges(
      { ...base, plan: "lista", planUntil: new Date("2026-12-13T12:00:00Z"), planSource: "pago" },
      NOW,
    );
    expect(porVencer.find((b) => b.key === "por_vencer")?.label).toBe("Vence en 3 días");
    const vencido = personBadges(
      { ...base, plan: "lista", planUntil: new Date("2026-12-01"), planSource: "pago" },
      NOW,
    );
    expect(vencido.find((b) => b.key === "vencido")?.tone).toBe("warning");
    const beca = personBadges(
      { ...base, plan: "lista", planUntil: new Date("2027-01-30"), planSource: "beca" },
      NOW,
    );
    expect(beca.map((b) => b.key)).toContain("becado");
  });

  it("marca admin, tester, prueba y onboarding pendiente", () => {
    const b = personBadges(
      { ...base, isAdmin: true, isTester: true, isTest: true, onboarded: false },
      NOW,
    ).map((x) => x.key);
    expect(b).toEqual(expect.arrayContaining(["admin", "tester", "prueba", "sin_onboarding"]));
  });
});

describe("historial y mensajes", () => {
  it("toda acción del historial tiene su texto", () => {
    for (const a of [
      "tester_si",
      "tester_no",
      "bloquear",
      "desbloquear",
      "prueba_si",
      "prueba_no",
      "plan_activar",
      "plan_renovar",
      "plan_quitar",
      "plan_rechazar_aviso",
      "plan_marca",
    ]) {
      expect(ADMIN_HISTORY_LABELS[a], a).toBeTruthy();
    }
    expect(historyLabel("plan_activar", "beca")).toBe("Plan activado (beca)");
    expect(historyLabel("algo_nuevo", null)).toBe("algo_nuevo");
  });

  it("cada resultado de la base tiene un mensaje para la persona que administra", () => {
    expect(personActionMessage("bloquear", "ok")).toEqual({
      ok: true,
      message: "Cuenta bloqueada. Sus sesiones abiertas se cerraron.",
    });
    expect(personActionMessage("bloquear", "es_admin").ok).toBe(false);
    expect(personActionMessage("bloquear", "propia").message).toMatch(/tu propia cuenta/);
    expect(personActionMessage("tester_si", "sin_cambio").ok).toBe(true);
    expect(personActionMessage("prueba_no", "no_existe").ok).toBe(false);
    expect(personActionMessage("desbloquear", "raro").ok).toBe(false);
  });
});

describe("roles de la base en las etapas «testers»", () => {
  it("hasDbRole solo acepta roles conocidos", () => {
    expect(hasDbRole(["tester"], "tester")).toBe(true);
    expect(hasDbRole([], "tester")).toBe(false);
    expect(hasDbRole(["admin"], "tester")).toBe(false);
    expect(hasDbRole(null, "tester")).toBe(false);
  });

  it("suma el email a ASSISTANT_TESTER_EMAILS sin tocar el resto ni el env original", () => {
    const env = { ADMIN_EMAILS: "a@x.com", ASSISTANT_TESTER_EMAILS: "b@x.com", OTRO: "1" };
    const out = withDbTesters(env, "C@X.com", ["tester"]);
    expect(out.ASSISTANT_TESTER_EMAILS).toBe("b@x.com,c@x.com");
    expect(out.ADMIN_EMAILS).toBe("a@x.com");
    expect(out.OTRO).toBe("1");
    expect(env.ASSISTANT_TESTER_EMAILS).toBe("b@x.com");
  });

  it("sin rol, sin email o con la lista vacía devuelve lo que corresponde", () => {
    const env = { ASSISTANT_TESTER_EMAILS: "" };
    expect(withDbTesters(env, "c@x.com", [])).toBe(env);
    expect(withDbTesters(env, null, ["tester"])).toBe(env);
    expect(withDbTesters(env, "c@x.com", ["tester"]).ASSISTANT_TESTER_EMAILS).toBe("c@x.com");
    expect(
      withDbTesters({} as Record<string, string | undefined>, "c@x.com", ["tester"])
        .ASSISTANT_TESTER_EMAILS,
    ).toBe("c@x.com");
  });

  it("ser tester en la base nunca da permisos de admin", () => {
    const out = withDbTesters({ ADMIN_EMAILS: "" }, "c@x.com", ["tester"]);
    expect(out.ADMIN_EMAILS).toBe("");
  });
});
