import { describe, expect, it } from "vitest";
import {
  formatInboundAddress,
  INBOUND_TOKEN_BYTES,
  isInboundToken,
  isLegacyInboundAddress,
  tokenFromBytes,
} from "./inbound-address";

const USER = "a1b2c3d4-0000-4000-8000-000000000001";

describe("tokenFromBytes", () => {
  it("devuelve 20 caracteres base32 en minúscula", () => {
    const token = tokenFromBytes(new Uint8Array(16).fill(255));
    expect(token).toHaveLength(20);
    expect(isInboundToken(token)).toBe(true);
  });

  it("es determinista y distingue bytes distintos", () => {
    const a = Uint8Array.from({ length: 16 }, (_, i) => i);
    const b = Uint8Array.from({ length: 16 }, (_, i) => i + 1);
    expect(tokenFromBytes(a)).toBe(tokenFromBytes(a));
    expect(tokenFromBytes(a)).not.toBe(tokenFromBytes(b));
  });

  it("codifica con el alfabeto base32 conocido", () => {
    expect(tokenFromBytes(new Uint8Array(INBOUND_TOKEN_BYTES))).toBe("aaaaaaaaaaaaaaaaaaaa");
  });

  it("rechaza menos de 100 bits de entropía", () => {
    expect(() => tokenFromBytes(new Uint8Array(12))).toThrow();
  });
});

describe("isInboundToken", () => {
  it("acepta 20 caracteres a-z2-7", () => {
    expect(isInboundToken("abcdefghijklmnopqrst")).toBe(true);
    expect(isInboundToken("234567abcdefghijklmn")).toBe(true);
  });
  it("rechaza largo, mayúsculas y caracteres fuera del alfabeto", () => {
    expect(isInboundToken("abcdefghijklmnopqrs")).toBe(false);
    expect(isInboundToken("abcdefghijklmnopqrstu")).toBe(false);
    expect(isInboundToken("ABCDEFGHIJKLMNOPQRST")).toBe(false);
    expect(isInboundToken("abcdefghijklmnopqr01")).toBe(false);
    expect(isInboundToken("abcdefghijklmnopqr@t")).toBe(false);
  });
});

describe("formatInboundAddress", () => {
  it("arma u_<token>@<dominio> en minúscula", () => {
    expect(formatInboundAddress("ABCDEFGHIJKLMNOPQRST", "Ingest.Test")).toBe(
      "u_abcdefghijklmnopqrst@ingest.test",
    );
  });
});

describe("isLegacyInboundAddress", () => {
  it("reconoce la derivada del id", () => {
    expect(isLegacyInboundAddress("u_a1b2c3d4@ingest.test", USER)).toBe(true);
    expect(isLegacyInboundAddress("U_A1B2C3D4@Ingest.Test", USER)).toBe(true);
  });
  it("no toma una aleatoria ni la derivada de otro usuario", () => {
    expect(isLegacyInboundAddress("u_abcdefghijklmnopqrst@ingest.test", USER)).toBe(false);
    expect(isLegacyInboundAddress("u_ffffffff@ingest.test", USER)).toBe(false);
    expect(isLegacyInboundAddress("otra@ingest.test", USER)).toBe(false);
  });
});
