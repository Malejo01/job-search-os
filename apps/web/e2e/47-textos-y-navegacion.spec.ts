import { expect, test, type Page } from "@playwright/test";
import {
  createEvaluation,
  createJob,
  deleteJob,
  ensureSecondUser,
  loginAsSecondUser,
  login,
  removeSecondUser,
} from "./helpers";

/**
 * Flujo 47 (ronda 73): textos en lenguaje claro y navegación a 360 px. El config corre a 390 px;
 * acá se baja a 360 (el celular más angosto que soportamos). Sin red. Todo inventado.
 */
test.use({ viewport: { width: 360, height: 780 } });
test.describe.configure({ mode: "serial" });

const OLD_TEXTS = /Pendientes de JD|Prefiltrada|Match fuerte/;

async function scrollWidth(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth);
}

test.describe("Flujo 47: textos y navegación", () => {
  const tag = Date.now();
  const jobIds: string[] = [];

  test.beforeAll(async () => {
    const pending = await createJob({
      title: `Oferta Ficticia Sin Descripcion ${tag}`,
      status: "pendiente_jd",
    });
    const toEvaluate = await createJob({
      title: `Oferta Ficticia Por Evaluar ${tag}`,
      status: "prefiltrada",
      jdText: "Descripción ficticia para el flujo de textos.",
    });
    const evaluated = await createJob({
      title: `Oferta Ficticia Evaluada ${tag}`,
      status: "evaluada",
      jdText: "Descripción ficticia para el flujo de textos.",
    });
    await createEvaluation(evaluated);
    jobIds.push(pending, toEvaluate, evaluated);
  });

  test.afterAll(async () => {
    for (const id of jobIds) await deleteJob(id);
  });

  test("a 360 px no hay scroll horizontal en /jobs, /jobs/pending-jd, /inbox y /market", async ({
    page,
  }) => {
    await login(page);
    for (const path of ["/jobs", "/jobs/pending-jd", "/inbox", "/market"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      expect(await scrollWidth(page), `scrollWidth en ${path}`).toBeLessThanOrEqual(360);
    }
  });

  test("el menú llega a todas las secciones y marca la actual con aria-current", async ({
    page,
  }) => {
    await login(page);
    const menu = page.getByTestId("menu-movil");
    const sections: Array<[string, string]> = [
      ["Ofertas", "/jobs"],
      ["Sin descripción", "/jobs/pending-jd"],
      ["Emails", "/inbox"],
      ["Postulaciones", "/applications"],
      ["Mercado", "/market"],
      ["Plan", "/plan"],
    ];
    // Por debajo de `sm` solo se ve el botón «Menú»; la fila de links no ocupa lugar
    await expect(menu).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Secciones" })).toHaveCount(0);
    const summary = menu.locator("summary");
    for (const [label, path] of sections) {
      await summary.click();
      await menu.getByRole("link", { name: label, exact: true }).click();
      await page.waitForURL(`**${path}`);
      // Navegar cierra el menú; al abrirlo, la sección actual está marcada y las demás no
      await expect(menu).not.toHaveAttribute("open", "");
      await expect(summary).toContainText(`Menú · ${label}`);
      await summary.click();
      await expect(menu.getByRole("link", { name: label, exact: true })).toHaveAttribute(
        "aria-current",
        "page",
      );
      await expect(menu.locator('a[aria-current="page"]')).toHaveCount(1);
      await summary.click();
      expect(await scrollWidth(page), `scrollWidth en ${path}`).toBeLessThanOrEqual(360);
    }
  });

  test("en pantalla ancha la nav es una fila de links y no hay menú", async ({ page }) => {
    await login(page);
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto("/jobs/pending-jd");
    const nav = page.getByRole("navigation", { name: "Secciones" });
    await expect(nav).toBeVisible();
    await expect(page.getByTestId("menu-movil")).toBeHidden();
    await expect(nav.getByRole("link", { name: "Sin descripción" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(nav.getByRole("link", { name: "Ofertas", exact: true })).not.toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  test("«+ Cargar oferta» está junto al título, mide 44 px y lleva a /jobs/new", async ({
    page,
  }) => {
    await login(page);
    await page.goto("/jobs");
    const button = page.getByRole("link", { name: "+ Cargar oferta" });
    await expect(button).toBeVisible();
    const box = await button.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(360);
    await button.click();
    await page.waitForURL("**/jobs/new");
  });

  test("textos nuevos y sin los viejos en /jobs, sin descripción, detalle y mercado", async ({
    page,
  }) => {
    await login(page);
    await page.goto("/jobs/pending-jd");
    await expect(page.getByRole("heading", { level: 1, name: "Sin descripción" })).toBeVisible();
    await expect(page.getByText("Cómo completar una oferta")).toBeVisible();
    await expect(page.getByText(/Claude in Chrome/)).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText(OLD_TEXTS);

    await page.goto("/jobs?estado=todas");
    await expect(page.locator("body")).not.toContainText(OLD_TEXTS);

    await page.goto("/jobs?estado=todas");
    await page
      .getByRole("link", { name: new RegExp(`Oferta Ficticia Evaluada ${tag}`) })
      .first()
      .click();
    await expect(page.getByRole("heading", { name: "Lo que ya tenés" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Lo que te falta" })).toBeVisible();
    await expect(page.locator("body")).not.toContainText(OLD_TEXTS);

    await page.goto("/market");
    await expect(page.locator("body")).not.toContainText(/Match fuerte|Pendientes de JD/);
  });

  test("lista vacía por filtros con ofertas sin evaluar: lo dice y las muestra", async ({
    page,
  }) => {
    await login(page);
    // Una fuente sin ofertas deja la lista vacía aunque haya ofertas en otros estados
    await page.goto("/jobs?fuente=ashby&estado=todas");
    const box = page.getByTestId("jobs-empty-unevaluated");
    await expect(box).toContainText(/Tenés (1 oferta|\d+ ofertas) que todavía no evaluamos/);
    await expect(box.getByRole("link", { name: "verlas" })).toHaveAttribute(
      "href",
      "/jobs?estado=prefiltrada",
    );
    await expect(box).toContainText(/Tenés (1 oferta|\d+ ofertas) sin descripción/);
    await expect(box.getByRole("link", { name: /completarlas?/ })).toHaveAttribute(
      "href",
      "/jobs/pending-jd",
    );
    await expect(page.locator("body")).not.toContainText("Sin ofertas con estos filtros");
  });

  test.describe("persona nueva, sin ninguna oferta", () => {
    test.beforeAll(async () => {
      await ensureSecondUser();
    });
    test.afterAll(async () => {
      await removeSecondUser();
    });

    test("/jobs explica cómo conseguir las primeras con un link a cada camino", async ({
      page,
    }) => {
      await loginAsSecondUser(page);
      await page.goto("/jobs");
      const empty = page.getByTestId("jobs-empty-none");
      await expect(empty).toContainText("Todavía no tenés ofertas");
      await expect(empty.getByRole("link", { name: /Cargar una oferta/ })).toHaveAttribute(
        "href",
        "/jobs/new",
      );
      await expect(empty.getByRole("link", { name: /Reenviar tus alertas/ })).toHaveAttribute(
        "href",
        "/settings/asistente",
      );
      await expect(empty.getByRole("link", { name: /Esperar las ofertas/ })).toHaveAttribute(
        "href",
        "/settings#puesto",
      );
      expect(await scrollWidth(page)).toBeLessThanOrEqual(360);
    });
  });
});
