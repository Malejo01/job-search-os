import { describe, expect, it } from "vitest";
import { err, ok } from "../result";
import { canonicalUrl } from "./url";

describe("canonicalUrl", () => {
  const LI = "https://linkedin.com/jobs/view/4123456789";

  it("LinkedIn: currentJobId en búsqueda → /jobs/view/{id}", () => {
    expect(
      canonicalUrl(
        "https://www.linkedin.com/jobs/search/?currentJobId=4123456789&keywords=ai%20engineer&refresh=true",
      ),
    ).toEqual(ok(LI));
  });

  it("LinkedIn: /jobs/view/{id}/ con tracking → limpio", () => {
    expect(
      canonicalUrl(
        "https://www.linkedin.com/jobs/view/4123456789/?refId=abc&trackingId=xyz&utm_source=email",
      ),
    ).toEqual(ok(LI));
  });

  it("LinkedIn: links de email (/comm/jobs/view) y slugs con id al final", () => {
    expect(canonicalUrl("https://www.linkedin.com/comm/jobs/view/4123456789?trk=eml-jobs")).toEqual(
      ok(LI),
    );
    expect(
      canonicalUrl("https://www.linkedin.com/jobs/view/senior-ai-engineer-at-acme-4123456789"),
    ).toEqual(ok(LI));
    expect(canonicalUrl("https://ar.linkedin.com/jobs/view/4123456789")).toEqual(ok(LI));
  });

  it("quita utm_* y otros params de tracking, conserva el resto ordenado", () => {
    expect(
      canonicalUrl(
        "https://www.getonboard.com/jobs/programming/senior-fullstack-empresa-f?utm_source=alert&utm_medium=email",
      ),
    ).toEqual(ok("https://getonboard.com/jobs/programming/senior-fullstack-empresa-f"));
    expect(canonicalUrl("https://example.com/jobs?b=2&a=1&fbclid=x&gclid=y")).toEqual(
      ok("https://example.com/jobs?a=1&b=2"),
    );
  });

  it("Indeed: conserva solo jk", () => {
    expect(canonicalUrl("https://ar.indeed.com/viewjob?jk=abc123&from=serp&tk=1&vjs=3")).toEqual(
      ok("https://ar.indeed.com/viewjob?jk=abc123"),
    );
  });

  it("normaliza esquema/host, quita www., fragmento y barra final; conserva mayúsculas del path", () => {
    expect(canonicalUrl("HTTPS://Example.com/Jobs/123/#apply")).toEqual(
      ok("https://example.com/Jobs/123"),
    );
    expect(canonicalUrl("  https://example.com/  ")).toEqual(ok("https://example.com"));
  });

  it("rechaza lo que no es URL http(s)", () => {
    expect(canonicalUrl("no es una url")).toEqual(err("invalid_url"));
    expect(canonicalUrl("mailto:jobs@example.com")).toEqual(err("invalid_url"));
    expect(canonicalUrl("")).toEqual(err("invalid_url"));
  });
});
