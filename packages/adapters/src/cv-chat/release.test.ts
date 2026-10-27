import type { Db } from "@job-search-os/db";
import { describe, expect, it } from "vitest";
import { releaseCvChatReservation } from "./reserve";

/** Soltar la reserva corre en un `finally`: no puede lanzar ni tapar el resultado del paso. */
describe("releaseCvChatReservation", () => {
  const failing = {
    delete: () => ({
      where: () => Promise.reject(new Error("conexión caída")),
    }),
  } as unknown as Db;

  it("si el borrado falla devuelve false en vez de lanzar", async () => {
    await expect(releaseCvChatReservation(failing, "id-de-reserva")).resolves.toBe(false);
  });

  it("sin reserva no hace nada", async () => {
    await expect(releaseCvChatReservation(failing, null)).resolves.toBe(true);
  });
});
