import { describe, expect, it } from "vitest";
import { profileAgentAccess, profileAgentFlagFor } from "./access";

const ENV_ALL = { CV_IMPORT_ENABLED: "1", CV_PROFILE_AGENT: "all" };
const ENV_TESTERS = {
  CV_IMPORT_ENABLED: "1",
  CV_PROFILE_AGENT: "testers",
  ADMIN_EMAILS: "persona-admin@example.com",
};

/** Un juego de comprobaciones que anota el orden en que se llamaron. */
function checks(
  calls: string[],
  result: { session?: string | null; flag?: boolean; ticket?: boolean; cap?: boolean } = {},
) {
  const r = { session: "u1", flag: true, ticket: true, cap: true, ...result };
  return {
    session: async () => (calls.push("session"), r.session),
    flag: async () => (calls.push("flag"), r.flag),
    ticket: async () => (calls.push("ticket"), r.ticket),
    cap: async () => (calls.push("cap"), r.cap),
  };
}

describe("profileAgentAccess: orden sesión → flag → ticket → tope", () => {
  it("todo en orden pasa y las comprobaciones corren en ese orden", async () => {
    const calls: string[] = [];
    const r = await profileAgentAccess(checks(calls));
    expect(r).toEqual({ ok: true, userId: "u1" });
    expect(calls).toEqual(["session", "flag", "ticket", "cap"]);
  });

  it("sin sesión: 401 y no se mira nada más (ni el flag ni la base)", async () => {
    const calls: string[] = [];
    const r = await profileAgentAccess(checks(calls, { session: null, flag: false }));
    expect(r).toEqual({ ok: false, stage: "session", status: 401 });
    expect(calls).toEqual(["session"]);
  });

  it("flag apagado: 404 antes que el ticket y el tope, aunque el ticket también esté mal", async () => {
    const calls: string[] = [];
    const r = await profileAgentAccess(checks(calls, { flag: false, ticket: false, cap: false }));
    expect(r).toEqual({ ok: false, stage: "flag", status: 404 });
    expect(calls).toEqual(["session", "flag"]);
  });

  it("ticket inválido: 409 antes que el tope", async () => {
    const calls: string[] = [];
    const r = await profileAgentAccess(checks(calls, { ticket: false, cap: false }));
    expect(r).toEqual({ ok: false, stage: "ticket", status: 409 });
    expect(calls).toEqual(["session", "flag", "ticket"]);
  });

  it("tope alcanzado: 429, y solo después de las otras tres", async () => {
    const calls: string[] = [];
    const r = await profileAgentAccess(checks(calls, { cap: false }));
    expect(r).toEqual({ ok: false, stage: "cap", status: 429 });
    expect(calls).toEqual(["session", "flag", "ticket", "cap"]);
  });

  it("las etapas que no se piden no se corren (una ruta sin ticket ni tope)", async () => {
    const calls: string[] = [];
    const c = checks(calls);
    const r = await profileAgentAccess({ session: c.session, flag: c.flag });
    expect(r).toEqual({ ok: true, userId: "u1" });
    expect(calls).toEqual(["session", "flag"]);
  });

  it("una comprobación que lanza una excepción cierra en esa etapa, nunca abre", async () => {
    const r = await profileAgentAccess({
      session: async () => "u1",
      flag: async () => {
        throw new Error("base caída");
      },
    });
    expect(r).toEqual({ ok: false, stage: "flag", status: 404 });
  });
});

describe("profileAgentFlagFor: una sola lectura del flag", () => {
  it("apagado o sin CV_IMPORT_ENABLED: no pregunta el email a la base", async () => {
    let asked = 0;
    const email = async () => (asked++, "persona-admin@example.com");
    expect(await profileAgentFlagFor({ CV_PROFILE_AGENT: "all" }, email)).toBe(false);
    expect(await profileAgentFlagFor({ CV_IMPORT_ENABLED: "1" }, email)).toBe(false);
    expect(
      await profileAgentFlagFor({ CV_IMPORT_ENABLED: "1", CV_PROFILE_AGENT: "off" }, email),
    ).toBe(false);
    expect(asked).toBe(0);
  });

  it("testers: solo pasa el email de la lista", async () => {
    expect(await profileAgentFlagFor(ENV_TESTERS, async () => "persona-admin@example.com")).toBe(
      true,
    );
    expect(await profileAgentFlagFor(ENV_TESTERS, async () => "otra-persona@example.com")).toBe(
      false,
    );
    expect(await profileAgentFlagFor(ENV_TESTERS, async () => null)).toBe(false);
  });

  it("testers: si la consulta del email falla, cierra", async () => {
    const boom = async (): Promise<string | null> => {
      throw new Error("base caída");
    };
    expect(await profileAgentFlagFor(ENV_TESTERS, boom)).toBe(false);
  });

  it("all: pasa toda persona con sesión", async () => {
    expect(await profileAgentFlagFor(ENV_ALL, async () => "otra-persona@example.com")).toBe(true);
  });
});
