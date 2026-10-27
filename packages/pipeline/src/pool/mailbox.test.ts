import { describe, expect, it } from "vitest";
import { isPoolMailboxAddress, parsePoolMailbox } from "./mailbox";

const OPTS = {
  ingestDomain: "ingest.ejemplo.test",
  careers: ["finanzas_contabilidad", "rrhh_it", "marketing_digital"],
};

describe("parsePoolMailbox", () => {
  it("acepta una casilla válida y devuelve la carrera", () => {
    expect(parsePoolMailbox("pool-rrhh_it@ingest.ejemplo.test", OPTS)).toEqual({
      ok: true,
      career: "rrhh_it",
    });
  });

  it("compara en minúsculas, con o sin nombre visible", () => {
    expect(parsePoolMailbox("POOL-RRHH_IT@Ingest.Ejemplo.Test", OPTS)).toEqual({
      ok: true,
      career: "rrhh_it",
    });
    expect(parsePoolMailbox("Pool <pool-rrhh_it@ingest.ejemplo.test>", OPTS)).toEqual({
      ok: true,
      career: "rrhh_it",
    });
  });

  it("rechaza una carrera inexistente", () => {
    expect(parsePoolMailbox("pool-astronauta@ingest.ejemplo.test", OPTS)).toEqual({
      ok: false,
      reason: "unknown_career",
    });
  });

  it("rechaza otro dominio", () => {
    expect(parsePoolMailbox("pool-rrhh_it@otro.test", OPTS)).toEqual({
      ok: false,
      reason: "wrong_domain",
    });
    expect(parsePoolMailbox("pool-rrhh_it@sub.ingest.ejemplo.test", OPTS).ok).toBe(false);
  });

  it("rechaza pool- sin carrera y direcciones que no son de pool", () => {
    expect(parsePoolMailbox("pool-@ingest.ejemplo.test", OPTS).ok).toBe(false);
    expect(parsePoolMailbox("pool@ingest.ejemplo.test", OPTS)).toEqual({
      ok: false,
      reason: "not_pool",
    });
    expect(parsePoolMailbox("u_abc@ingest.ejemplo.test", OPTS).ok).toBe(false);
  });

  it("rechaza inyecciones y comodines", () => {
    for (const to of [
      "pool-rrhh_it+x@ingest.ejemplo.test",
      "pool-rrhh_it+finanzas_contabilidad@ingest.ejemplo.test",
      "pool-../x@ingest.ejemplo.test",
      "pool-*@ingest.ejemplo.test",
      "pool-rrhh_it @ingest.ejemplo.test",
      "pool-rrhh_it@ingest.ejemplo.test@otro.test",
    ]) {
      expect(parsePoolMailbox(to, OPTS).ok, to).toBe(false);
    }
  });

  it("sin dominio de ingesta configurado rechaza todo", () => {
    expect(
      parsePoolMailbox("pool-rrhh_it@ingest.ejemplo.test", { ...OPTS, ingestDomain: "" }).ok,
    ).toBe(false);
  });
});

describe("isPoolMailboxAddress", () => {
  it("detecta el prefijo pool- sin validar la carrera", () => {
    expect(isPoolMailboxAddress("pool-lo-que-sea@x.test")).toBe(true);
    expect(isPoolMailboxAddress("Pool <POOL-a@x.test>")).toBe(true);
    expect(isPoolMailboxAddress("u_123@x.test")).toBe(false);
  });
});
