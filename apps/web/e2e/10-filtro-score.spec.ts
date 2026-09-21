import { expect, test } from "@playwright/test";
import { login } from "./helpers";

/** Flujo 10 (JS-029): el score mínimo se elige de 0 a 9, de a un punto, y vive en la URL. */
test.describe("Flujo 10: filtro de score libre", () => {
  test("ofrece de 0 a 9, filtra con cualquier valor y descarta valores fuera de rango", async ({
    page,
  }) => {
    await login(page);
    const filtro = page.getByLabel("Score mín.");
    await expect(filtro.locator("option")).toHaveText([
      "cualquiera",
      ...Array.from({ length: 10 }, (_, n) => `≥ ${n}`),
    ]);

    // Un valor que la lista fija vieja no tenía
    await filtro.selectOption("6");
    await expect(page).toHaveURL(/score=6/);
    const scores = page.locator('[aria-label^="score "]');
    await expect
      .poll(
        async () => {
          const labels = await scores.evaluateAll((els) =>
            els.map((e) => e.getAttribute("aria-label") ?? ""),
          );
          const seen = labels.map((l) => Number(l.replace("score ", "")));
          return seen.every((n) => n >= 6) ? "ok" : `hay < 6: ${seen.join(",")}`;
        },
        { timeout: 15_000 },
      )
      .toBe("ok");

    // Fuera de rango o no entero en la URL: se ignora (sin filtro), no rompe la página
    for (const raro of ["12", "-1", "6.5", "abc"]) {
      await page.goto(`/jobs?score=${raro}`);
      await expect(page.getByLabel("Score mín.")).toHaveValue("");
    }
  });
});
