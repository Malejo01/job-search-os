import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword, verifyPasswordAsync } from "./password";

describe("verifyPasswordAsync", () => {
  const stored = hashPassword("clave-de-prueba-1");

  it("acepta la clave correcta y rechaza la incorrecta, igual que la versión sincrónica", async () => {
    await expect(verifyPasswordAsync("clave-de-prueba-1", stored)).resolves.toBe(true);
    await expect(verifyPasswordAsync("otra-clave-de-prueba", stored)).resolves.toBe(false);
    expect(verifyPassword("clave-de-prueba-1", stored)).toBe(true);
  });

  it("rechaza un hash vacío o con otro formato sin tirar", async () => {
    await expect(verifyPasswordAsync("clave-de-prueba-1", null)).resolves.toBe(false);
    await expect(verifyPasswordAsync("clave-de-prueba-1", undefined)).resolves.toBe(false);
    await expect(verifyPasswordAsync("clave-de-prueba-1", "md5$aa$bb")).resolves.toBe(false);
    await expect(verifyPasswordAsync("clave-de-prueba-1", "scrypt$solo-sal")).resolves.toBe(false);
  });

  it("no bloquea el event loop mientras calcula", async () => {
    let ticks = 0;
    const timer = setInterval(() => (ticks += 1), 1);
    await verifyPasswordAsync("clave-de-prueba-1", stored);
    clearInterval(timer);
    expect(ticks).toBeGreaterThan(0);
  });
});
