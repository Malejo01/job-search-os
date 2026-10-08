import { describe, expect, it } from "vitest";
import { unexpectedError } from "./evaluate-job";

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
