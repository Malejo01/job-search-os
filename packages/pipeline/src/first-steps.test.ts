import { describe, expect, it } from "vitest";
import { firstSteps, type FirstStepsFacts } from "./first-steps";

const NONE: FirstStepsFacts = {
  skillsLoaded: false,
  hasJobs: false,
  hasVerdict: false,
  hasApplication: false,
  hasEmail: false,
  emailDeclined: false,
  nextEvaluatedJobId: null,
};

const byId = (facts: FirstStepsFacts, id: number) =>
  firstSteps(facts).items.find((i) => i.id === id)!;

describe("firstSteps", () => {
  it("sin datos: solo el perfil está hecho (1 de 5)", () => {
    const r = firstSteps(NONE);
    expect(r.total).toBe(5);
    expect(r.done).toBe(1);
    expect(r.complete).toBe(false);
    expect(r.items.map((i) => i.done)).toEqual([true, false, false, false, false, false]);
  });

  it("cada hecho tilda solo su ítem", () => {
    expect(byId({ ...NONE, skillsLoaded: true }, 2).done).toBe(true);
    expect(byId({ ...NONE, hasJobs: true }, 3).done).toBe(true);
    expect(byId({ ...NONE, hasVerdict: true }, 4).done).toBe(true);
    expect(byId({ ...NONE, hasApplication: true }, 5).done).toBe(true);
    expect(firstSteps({ ...NONE, hasJobs: true }).done).toBe(2);
  });

  it("ítem 2 pendiente enlaza a las skills; hecho no lleva link", () => {
    expect(byId(NONE, 2).link).toEqual({ label: "Cargar mis skills", href: "/settings/skills" });
    expect(byId({ ...NONE, skillsLoaded: true }, 2).link).toBeNull();
  });

  it("ítem 3 pendiente no tiene link", () => {
    expect(byId(NONE, 3).link).toBeNull();
    expect(byId(NONE, 3).text).toBe("Estamos buscando ofertas para tu puesto");
  });

  it("ítem 4 con evaluada enlaza al detalle; sin evaluadas no hay link y lo explica", () => {
    const con = byId({ ...NONE, nextEvaluatedJobId: "abc" }, 4);
    expect(con.link).toEqual({ label: "Abrir la mejor evaluada", href: "/jobs/abc" });
    const sin = byId(NONE, 4);
    expect(sin.link).toBeNull();
    expect(sin.help).toBe("Cuando haya una oferta evaluada, el link aparece acá");
    expect(byId({ ...NONE, hasVerdict: true, nextEvaluatedJobId: "abc" }, 4).link).toBeNull();
  });

  it("el ítem 6 es opcional: no suma al total ni a complete", () => {
    const base = {
      ...NONE,
      skillsLoaded: true,
      hasJobs: true,
      hasVerdict: true,
      hasApplication: true,
    };
    const sinMail = firstSteps(base);
    expect(sinMail.complete).toBe(true);
    expect(sinMail.done).toBe(5);
    expect(sinMail.total).toBe(5);
    const conMail = firstSteps({ ...base, hasEmail: true });
    expect(conMail.done).toBe(5);
    expect(conMail.total).toBe(5);
    expect(byId({ ...base, hasEmail: true }, 6).done).toBe(true);
  });

  it("completa solo con los ítems 1 a 5", () => {
    const casi = { ...NONE, skillsLoaded: true, hasJobs: true, hasVerdict: true, hasEmail: true };
    expect(firstSteps(casi).complete).toBe(false);
    expect(firstSteps({ ...casi, hasApplication: true }).complete).toBe(true);
  });

  it("ítem 6 descartado: texto fijo y sin link; con email recibido gana lo hecho", () => {
    const declined = byId({ ...NONE, emailDeclined: true }, 6);
    expect(declined.text).toBe("Alertas de email: no por ahora");
    expect(declined.link).toBeNull();
    expect(declined.done).toBe(false);
    const recibido = byId({ ...NONE, emailDeclined: true, hasEmail: true }, 6);
    expect(recibido.text).toBe("Tus alertas de email llegan");
    expect(byId(NONE, 6).link).toEqual({ label: "Conectar (5 min)", href: "/settings/asistente" });
    expect(byId(NONE, 6).optional).toBe(true);
  });
});
