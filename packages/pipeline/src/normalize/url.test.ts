import { describe, expect, it } from "vitest";
import { err, ok } from "../result";
import { canonicalUrl } from "./url";

describe("canonicalUrl", () => {
  const LI = "https://linkedin.com/jobs/view/0000123456";

  it("LinkedIn: currentJobId en búsqueda → /jobs/view/{id}", () => {
    expect(
      canonicalUrl(
        "https://www.linkedin.com/jobs/search/?currentJobId=0000123456&keywords=ai%20engineer&refresh=true",
      ),
    ).toEqual(ok(LI));
  });

  it("LinkedIn: /jobs/view/{id}/ con tracking → limpio", () => {
    expect(
      canonicalUrl(
        "https://www.linkedin.com/jobs/view/0000123456/?refId=abc&trackingId=xyz&utm_source=email",
      ),
    ).toEqual(ok(LI));
  });

  it("LinkedIn: links de email (/comm/jobs/view) y slugs con id al final", () => {
    expect(canonicalUrl("https://www.linkedin.com/comm/jobs/view/0000123456?trk=eml-jobs")).toEqual(
      ok(LI),
    );
    expect(
      canonicalUrl("https://www.linkedin.com/jobs/view/senior-ai-engineer-at-acme-0000123456"),
    ).toEqual(ok(LI));
    expect(canonicalUrl("https://ar.linkedin.com/jobs/view/0000123456")).toEqual(ok(LI));
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

  it("LinkedIn sin id reconocible: cae a la regla general (sin tracking, sin www)", () => {
    expect(canonicalUrl("https://www.linkedin.com/company/empresa-de-prueba/?trk=abc")).toEqual(
      ok("https://linkedin.com/company/empresa-de-prueba"),
    );
    // currentJobId no numérico se ignora
    expect(canonicalUrl("https://linkedin.com/jobs/search/?currentJobId=abc&q=x")).toEqual(
      ok("https://linkedin.com/jobs/search?currentJobId=abc&q=x"),
    );
  });

  it("un dominio que solo termina parecido a linkedin.com no se trata como LinkedIn", () => {
    expect(canonicalUrl("https://notlinkedin.com/jobs/view/123")).toEqual(
      ok("https://notlinkedin.com/jobs/view/123"),
    );
  });

  it("params repetidos y orden estable; tracking en mayúsculas", () => {
    expect(canonicalUrl("https://example.com/p?b=2&a=2&a=1&UTM_Campaign=x&FBCLID=y")).toEqual(
      ok("https://example.com/p?a=2&a=1&b=2"),
    );
  });

  it("Indeed sin jk queda sin query", () => {
    expect(canonicalUrl("https://www.indeed.com/viewjob?from=serp")).toEqual(
      ok("https://indeed.com/viewjob"),
    );
  });

  it("rechaza lo que no es URL http(s)", () => {
    expect(canonicalUrl("no es una url")).toEqual(err("invalid_url"));
    expect(canonicalUrl("mailto:jobs@example.com")).toEqual(err("invalid_url"));
    expect(canonicalUrl("")).toEqual(err("invalid_url"));
  });
});
