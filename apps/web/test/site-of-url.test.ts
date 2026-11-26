import { describe, expect, it } from "vitest";
import { siteOfUrl } from "../lib/site-of-url";

describe("siteOfUrl", () => {
  it("dominio sin www y en minúsculas", () => {
    expect(siteOfUrl("https://www.Empresa-A.example/jobs/1?x=2")).toBe("empresa-a.example");
    expect(siteOfUrl("http://jobs.empresa-b.example/x")).toBe("jobs.empresa-b.example");
  });

  it("lo que no es http(s) o no se entiende da null", () => {
    expect(siteOfUrl("javascript:alert(1)")).toBeNull();
    expect(siteOfUrl("ftp://empresa-a.example")).toBeNull();
    expect(siteOfUrl("no es una url")).toBeNull();
    expect(siteOfUrl("")).toBeNull();
  });
});
