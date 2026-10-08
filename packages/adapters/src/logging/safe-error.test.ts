import { describe, expect, it } from "vitest";
import { safeDbError } from "./safe-error";

describe("safeDbError", () => {
  it("toma código y constraint del error de postgres-js y no filtra message, query ni params", () => {
    const pg = Object.assign(new Error("duplicate key: JD secreto de Empresa A"), {
      name: "PostgresError",
      code: "23505",
      constraint_name: "jobs_user_id_external_id_key",
      query: "insert into jobs (jd_text) values ($1)",
      parameters: ["JD secreto de Empresa A"],
    });
    const out = safeDbError(pg);
    expect(out).toEqual({
      name: "PostgresError",
      code: "23505",
      constraint: "jobs_user_id_external_id_key",
    });
    expect(JSON.stringify(out)).not.toMatch(/secreto|insert|Empresa/);
  });

  it("baja a `cause` cuando Drizzle envuelve el error", () => {
    const cause = Object.assign(new Error("x"), { name: "PostgresError", code: "23502" });
    const wrapped = Object.assign(new Error("Failed query: insert ... params: JD secreto"), {
      name: "DrizzleQueryError",
      query: "insert",
      params: ["JD secreto"],
      cause,
    });
    const out = safeDbError(wrapped);
    expect(out).toEqual({ name: "PostgresError", code: "23502" });
  });

  it("un error sin código devuelve solo el nombre", () => {
    expect(safeDbError(new TypeError("texto del aviso"))).toEqual({ name: "TypeError" });
    expect(safeDbError("texto del aviso")).toEqual({ name: "UnknownError" });
    expect(safeDbError(null)).toEqual({ name: "UnknownError" });
  });
});
