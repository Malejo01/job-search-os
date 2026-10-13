import { describe, expect, it } from "vitest";
import { ROLE_KEYS } from "./self-assessment";
import { parseTargetRoles, targetRolesLimit } from "./target-roles";

describe("targetRolesLimit", () => {
  it("sin env ni perfil, 2", () => expect(targetRolesLimit({}, null)).toBe(2));
  it("el env válido manda", () => {
    expect(targetRolesLimit({ TARGET_ROLES_FREE_LIMIT: "3" }, null)).toBe(3);
    expect(targetRolesLimit({ TARGET_ROLES_FREE_LIMIT: " 1 " }, null)).toBe(1);
    expect(targetRolesLimit({ TARGET_ROLES_FREE_LIMIT: String(ROLE_KEYS.length) }, null)).toBe(
      ROLE_KEYS.length,
    );
  });
  it("env inválido = 2", () => {
    for (const v of ["", "0", "-1", "14", "2.5", "dos", "1e1", "NaN"]) {
      expect(targetRolesLimit({ TARGET_ROLES_FREE_LIMIT: v }, null), v).toBe(2);
    }
  });
  it("el máximo del perfil pisa al env", () => {
    expect(targetRolesLimit({ TARGET_ROLES_FREE_LIMIT: "2" }, 5)).toBe(5);
    expect(targetRolesLimit({ TARGET_ROLES_FREE_LIMIT: "4" }, 1)).toBe(1);
    expect(targetRolesLimit({}, 3)).toBe(3);
  });
  it("un máximo de perfil inválido se ignora", () => {
    expect(targetRolesLimit({ TARGET_ROLES_FREE_LIMIT: "3" }, 0)).toBe(3);
    expect(targetRolesLimit({}, 99)).toBe(2);
    expect(targetRolesLimit({}, 1.5)).toBe(2);
  });
});

describe("parseTargetRoles", () => {
  it("uno o varios válidos, en el orden recibido", () => {
    expect(parseTargetRoles(["qa"], 2)).toEqual({ ok: true, roles: ["qa"] });
    expect(parseTargetRoles(["ux_ui", "qa"], 2)).toEqual({ ok: true, roles: ["ux_ui", "qa"] });
  });
  it("0 puestos falla", () => {
    expect(parseTargetRoles([], 2)).toEqual({ ok: false, field: "targetRoles" });
  });
  it("más que el tope falla", () => {
    expect(parseTargetRoles(["qa", "ux_ui", "backend"], 2)).toEqual({
      ok: false,
      field: "targetRoles",
    });
    expect(parseTargetRoles(["qa", "ux_ui", "backend"], 3).ok).toBe(true);
  });
  it("repetidos fallan", () => {
    expect(parseTargetRoles(["qa", "qa"], 2)).toEqual({ ok: false, field: "targetRoles" });
  });
  it("clave inválida, vacía o con otra forma falla", () => {
    for (const v of ["otro", "", "QA", " qa", "__proto__", "devops "]) {
      expect(parseTargetRoles([v], 2), v).toEqual({ ok: false, field: "targetRoles" });
    }
    expect(parseTargetRoles(["qa", "nada"], 2)).toEqual({ ok: false, field: "targetRoles" });
  });
});
