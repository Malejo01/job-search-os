import { describe, expect, it } from "vitest";
import { seniorityBucket } from "./seniority-bucket";

describe("seniorityBucket · columna", () => {
  it.each([
    ["Trainee", "junior"],
    ["Junior", "junior"],
    ["jr", "junior"],
    ["Entry level", "junior"],
    ["Sin experiencia", "junior"],
    ["Semi Senior", "semi"],
    ["SSR", "semi"],
    ["Mid", "semi"],
    ["Midweight", "semi"],
    ["Intermediate", "semi"],
    ["Senior", "senior"],
    ["Sr", "senior"],
    ["Lead", "lead"],
    ["Staff", "lead"],
    ["Principal", "lead"],
    ["Director", "lead"],
    ["Head", "lead"],
    ["Expert", "lead"],
    ["Manager", "lead"],
  ] as const)("%s → %s", (column, bucket) => {
    expect(seniorityBucket(column, "Developer")).toBe(bucket);
  });

  it("acentos y mayúsculas", () => {
    expect(seniorityBucket("SEMI-SÉNIOR", "x")).toBe("semi");
  });

  it("con varios niveles vale el más bajo", () => {
    expect(seniorityBucket("Junior / Semi Senior", "x")).toBe("junior");
    expect(seniorityBucket("Senior, Lead", "x")).toBe("senior");
  });

  it("la columna manda sobre el título", () => {
    expect(seniorityBucket("Junior", "Senior Engineer")).toBe("junior");
  });
});

describe("seniorityBucket · respaldo en el título", () => {
  it("'Any' usa el título", () => {
    expect(seniorityBucket("Any", "Senior Backend Developer")).toBe("senior");
  });

  it("null y vacío usan el título", () => {
    expect(seniorityBucket(null, "Junior Designer")).toBe("junior");
    expect(seniorityBucket("", "Semi Senior QA")).toBe("semi");
    expect(seniorityBucket(null, "Tech Lead")).toBe("lead");
    expect(seniorityBucket(null, "Intern Developer")).toBe("junior");
  });

  it("título con varios niveles: el más bajo", () => {
    expect(seniorityBucket(null, "Junior / Semi Senior Developer")).toBe("junior");
  });

  it("sin señal en ninguno: unknown", () => {
    expect(seniorityBucket(null, "Software Developer")).toBe("unknown");
    expect(seniorityBucket("Any", "Software Developer")).toBe("unknown");
  });
});
