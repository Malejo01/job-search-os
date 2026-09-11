import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test.describe("Flujo 1: login → lista con filtros", () => {
  test("sin sesión redirige a /login; con sesión lista y el filtro persiste en la URL", async ({
    page,
  }) => {
    await page.goto("/jobs");
    await expect(page).toHaveURL(/\/login/);

    await login(page);
    await expect(page.getByRole("heading", { name: "Ofertas" })).toBeVisible();

    // Filtro por score mínimo: cambia la URL y la lista solo muestra scores ≥ 7
    await page.getByLabel("Score mín.").selectOption("7");
    await expect(page).toHaveURL(/score=7/);
    // La lista nueva llega después del cambio de URL (Server Component): se espera a que ningún
    // score visible sea menor a 7
    const scores = page.locator('[aria-label^="score "]');
    await expect
      .poll(
        async () => {
          const labels = await scores.evaluateAll((els) =>
            els.map((e) => e.getAttribute("aria-label") ?? ""),
          );
          if (!labels.length) return "vacía";
          const scoresSeen = labels.map((l) => Number(l.replace("score ", "")));
          return scoresSeen.every((n) => n >= 7) ? "ok" : `hay < 7: ${scoresSeen.join(",")}`;
        },
        { timeout: 15_000 },
      )
      .toBe("ok");

    // El filtro sobrevive a una recarga: vive en la URL, no en estado de cliente
    await page.reload();
    await expect(page.getByLabel("Score mín.")).toHaveValue("7");
    await page.getByRole("button", { name: "Limpiar" }).click();
    await expect(page).not.toHaveURL(/score=/);
  });
});
