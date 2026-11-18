import { describe, expect, it } from "vitest";
import { seedInboundAddress } from "./seed-inbound";

const USER = "aa300000-0000-4000-8000-000000000001";

describe("seedInboundAddress", () => {
  it("una cuenta nueva recibe una dirección aleatoria de 20 caracteres", () => {
    const address = seedInboundAddress(null, "ingest.test");
    expect(address).toMatch(/^u_[a-z2-7]{20}@ingest\.test$/);
    expect(address).not.toContain(USER.slice(0, 8));
  });

  it("dos cuentas nuevas reciben direcciones distintas", () => {
    expect(seedInboundAddress(null, "ingest.test")).not.toBe(
      seedInboundAddress(null, "ingest.test"),
    );
  });

  it("volver a sembrar conserva la dirección aleatoria y actualiza el dominio", () => {
    const existing = "u_abcdefghijklmnopqrst@viejo.test";
    expect(seedInboundAddress(existing, "nuevo.test")).toBe("u_abcdefghijklmnopqrst@nuevo.test");
  });

  it("una dirección derivada del id se reemplaza", () => {
    const address = seedInboundAddress(`u_${USER.slice(0, 8)}@ingest.test`, "ingest.test");
    expect(address).toMatch(/^u_[a-z2-7]{20}@ingest\.test$/);
  });
});
