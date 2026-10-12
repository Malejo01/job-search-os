import { describe, expect, it } from "vitest";
import { sourceUserAgent } from "./user-agent";

describe("sourceUserAgent", () => {
  it("usa el host de APP_URL, sin ruta ni query", () => {
    expect(sourceUserAgent({ APP_URL: "https://app.example.com/ruta?x=1" })).toBe(
      "JobSearchOS/1.0 (+https://app.example.com)",
    );
  });

  it("prioriza APP_URL, luego NEXT_PUBLIC_APP_URL, luego AUTH_URL", () => {
    expect(
      sourceUserAgent({
        APP_URL: "https://uno.example.com",
        NEXT_PUBLIC_APP_URL: "https://dos.example.com",
        AUTH_URL: "https://tres.example.com",
      }),
    ).toContain("uno.example.com");
    expect(
      sourceUserAgent({
        NEXT_PUBLIC_APP_URL: "https://dos.example.com",
        AUTH_URL: "https://tres.example.com",
      }),
    ).toContain("dos.example.com");
    expect(sourceUserAgent({ AUTH_URL: "https://tres.example.com" })).toContain("tres.example.com");
  });

  it("una URL inválida o con otro protocolo se ignora y pasa a la siguiente", () => {
    expect(sourceUserAgent({ APP_URL: "no es una url", AUTH_URL: "https://ok.example.com" })).toBe(
      "JobSearchOS/1.0 (+https://ok.example.com)",
    );
    expect(sourceUserAgent({ APP_URL: "ftp://x.example.com" })).toBe("JobSearchOS/1.0");
  });

  it("acepta http y conserva el puerto del origen", () => {
    expect(sourceUserAgent({ APP_URL: "http://localhost:3000/x" })).toBe(
      "JobSearchOS/1.0 (+http://localhost:3000)",
    );
  });

  it("sin ninguna variable → solo el producto", () => {
    expect(sourceUserAgent({})).toBe("JobSearchOS/1.0");
    expect(sourceUserAgent({ APP_URL: "  " })).toBe("JobSearchOS/1.0");
  });
});
