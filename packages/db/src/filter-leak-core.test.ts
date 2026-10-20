import { describe, expect, it } from "vitest";
// apps/web no tiene runner propio: la parte pura se prueba desde acá (como terms.test.ts).
import {
  safeBackPath,
  webmailErrorFromParams,
  webmailErrorUrl,
  webmailRejectionMessage,
} from "../../../apps/web/lib/filter-leak-core";

describe("safeBackPath", () => {
  it("acepta solo los destinos conocidos", () => {
    expect(safeBackPath("/inbox")).toBe("/inbox");
    expect(safeBackPath("/settings/senders")).toBe("/settings/senders");
    expect(safeBackPath("/inbox/123e4567-e89b-12d3-a456-426614174000")).toBe(
      "/inbox/123e4567-e89b-12d3-a456-426614174000",
    );
  });

  it("todo lo demás vuelve a /inbox", () => {
    for (const v of [
      "https://evil.example/inbox",
      "//evil.example",
      "/inbox?x=1",
      "/inbox/../admin",
      "/jobs",
      "",
      null,
      undefined,
      ["/jobs", "/inbox"],
    ]) {
      expect(safeBackPath(v)).toBe("/inbox");
    }
  });
});

describe("webmailErrorUrl", () => {
  it("arma la URL con el dominio codificado", () => {
    expect(webmailErrorUrl("/inbox", "gmail.com")).toBe("/inbox?error=webmail&sender=gmail.com");
    expect(webmailErrorUrl("/inbox", "a&b=c")).toBe("/inbox?error=webmail&sender=a%26b%3Dc");
  });
});

describe("webmailErrorFromParams", () => {
  it("devuelve el mensaje para un webmail", () => {
    expect(webmailErrorFromParams({ error: "webmail", sender: "gmail.com" })).toBe(
      webmailRejectionMessage("gmail.com"),
    );
    expect(webmailErrorFromParams({ error: "webmail", sender: "Mail.Yahoo.com.ar" })).toContain(
      "yahoo.com.ar",
    );
  });

  it("null si no corresponde", () => {
    expect(webmailErrorFromParams({})).toBeNull();
    expect(webmailErrorFromParams({ error: "otro", sender: "gmail.com" })).toBeNull();
    expect(webmailErrorFromParams({ error: "webmail" })).toBeNull();
    expect(webmailErrorFromParams({ error: "webmail", sender: "empresa-a.example" })).toBeNull();
    expect(webmailErrorFromParams({ error: "webmail", sender: "no es un dominio" })).toBeNull();
  });

  it("un searchParam repetido (array) se ignora", () => {
    expect(webmailErrorFromParams({ error: ["webmail", "x"], sender: "gmail.com" })).toBeNull();
    expect(webmailErrorFromParams({ error: "webmail", sender: ["gmail.com", "x"] })).toBeNull();
  });
});
