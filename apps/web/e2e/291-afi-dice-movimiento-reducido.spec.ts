import * as s from "@job-search-os/db/schema";
import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import {
  E2E_B_USER_ID,
  ensureSecondUser,
  loginAsSecondUser,
  ownerDb,
  removeSecondUser,
} from "./helpers";

/**
 * Flujo 291 (R28-15): con `prefers-reduced-motion: reduce`, el saludo de Afi en Hoy no tiene ningún transform
 * animado (ni el de entrada ni el fundido entre poses): aparece quieto. Persona B (ficticia).
 */
test.use({ reducedMotion: "reduce" });

test.describe("Flujo 291: Afi que habla con movimiento reducido (R28-15)", () => {
  test.afterAll(async () => {
    await removeSecondUser().catch(() => {});
  });

  test("el saludo de Hoy sale sin animación", async ({ page }) => {
    await ensureSecondUser();
    const { db, close } = ownerDb();
    try {
      await db
        .update(s.profiles)
        .set({ saludoVisto: null })
        .where(eq(s.profiles.userId, E2E_B_USER_ID));
    } finally {
      await close();
    }
    await loginAsSecondUser(page);
    const saludo = page.getByTestId("mascota-saludo");
    await expect(saludo).toBeVisible();
    const animado = saludo.locator("[data-afi-animado]");
    await expect(animado).toHaveAttribute("data-movimiento", "reducido");
    // Ni el contenedor animado ni nada dentro de él lleva un transform o una transición de movimiento
    const transforms = await animado.evaluate((el) => {
      const todos = [el, ...Array.from(el.querySelectorAll("*"))];
      return todos.map((n) => {
        const st = getComputedStyle(n as Element);
        return { t: st.transform, d: st.transitionDuration, a: st.animationName };
      });
    });
    for (const { t, d, a } of transforms) {
      expect(t === "none" || t === "matrix(1, 0, 0, 1, 0, 0)").toBe(true);
      expect(d.split(",").every((x) => parseFloat(x) === 0)).toBe(true);
      expect(a).toBe("none");
    }
  });
});
