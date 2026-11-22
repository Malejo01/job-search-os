import { describe, expect, it } from "vitest";
import { activeSection, SECTIONS } from "../app/(app)/sections";

describe("SECTIONS", () => {
  it("son Hoy, Match, CV, Tracker e Interview, en ese orden y con las mismas URLs", () => {
    expect(SECTIONS.map((s) => [s.label, s.href])).toEqual([
      ["Hoy", "/hoy"],
      ["Match", "/jobs"],
      ["CV", "/cv"],
      ["Tracker", "/applications"],
      ["Interview", "/interview"],
    ]);
  });
});

describe("activeSection", () => {
  it.each([
    ["/hoy", "/hoy"],
    ["/jobs", "/jobs"],
    ["/jobs/abc-123", "/jobs"],
    ["/jobs/pending-jd", "/jobs"],
    ["/cv", "/cv"],
    ["/cv/perfil", "/cv"],
    ["/applications", "/applications"],
    ["/interview", "/interview"],
    ["/interview/sesion-1", "/interview"],
  ])("%s marca %s", (path, expected) => {
    expect(activeSection(path)).toBe(expected);
  });

  it.each([
    "/academy",
    "/academy/ficha-1",
    "/settings/perfil",
    "/settings",
    "/inbox",
    "/market",
    "/plan",
    "/encaje",
  ])("%s está en «Más»: no marca ninguna pestaña", (path) => {
    expect(activeSection(path)).toBeNull();
  });

  it("no confunde prefijos parecidos", () => {
    expect(activeSection("/jobsmore")).toBeNull();
    expect(activeSection("/interviews")).toBeNull();
    expect(activeSection("/")).toBeNull();
  });
});
