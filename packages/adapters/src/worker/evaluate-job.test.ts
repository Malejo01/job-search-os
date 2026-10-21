import { describe, expect, it } from "vitest";
import { targetRoleLabelFor, unexpectedError } from "./evaluate-job";

describe("targetRoleLabelFor", () => {
  it("prioriza el puesto del pool, luego el principal de la lista, luego el puesto único", () => {
    expect(
      targetRoleLabelFor("marketing_digital", { targetRoles: ["qa"], targetRole: "ux_ui" }),
    ).toBe("Marketing digital");
    expect(
      targetRoleLabelFor(null, { targetRoles: ["marketing_digital", "qa"], targetRole: "ux_ui" }),
    ).toBe("Marketing digital");
    expect(
      targetRoleLabelFor(undefined, { targetRoles: [], targetRole: "marketing_digital" }),
    ).toBe("Marketing digital");
  });

  it("traduce la clave anterior producto_proyectos y rotula las carreras de producto", () => {
    expect(targetRoleLabelFor("producto_proyectos", {})).toBe("Product Manager");
    expect(targetRoleLabelFor(null, { targetRoles: ["producto_proyectos"] })).toBe(
      "Product Manager",
    );
    expect(targetRoleLabelFor("product_owner", {})).toBe("Product Owner");
    expect(targetRoleLabelFor("project_manager", {})).toBe("Project Manager / Scrum");
    expect(targetRoleLabelFor("product_marketing", {})).toBe("Product Marketing");
  });

  it("ignora valores que no son un puesto conocido y devuelve null si no queda ninguno", () => {
    expect(targetRoleLabelFor("inventado", { targetRoles: ["marketing_digital"] })).toBe(
      "Marketing digital",
    );
    expect(targetRoleLabelFor("inventado", { targetRoles: ["otro"], targetRole: null })).toBeNull();
    expect(targetRoleLabelFor(null, {})).toBeNull();
  });
});

describe("unexpectedError", () => {
  it("una excepción con texto de JD no llega al error del outcome", () => {
    const e = Object.assign(new Error("Failed query: insert ... params: TEXTO-DEL-JD"), {
      name: "DrizzleQueryError",
      cause: Object.assign(new Error("TEXTO-DEL-JD"), {
        name: "PostgresError",
        code: "23505",
        constraint_name: "jobs_pkey",
      }),
    });
    const out = unexpectedError(e);
    expect(out).toBe("PostgresError 23505 jobs_pkey");
    expect(out).not.toContain("TEXTO-DEL-JD");
    expect(unexpectedError(new Error("TEXTO-DEL-JD"))).toBe("Error");
    expect(unexpectedError("TEXTO-DEL-JD")).toBe("UnknownError");
  });
});
