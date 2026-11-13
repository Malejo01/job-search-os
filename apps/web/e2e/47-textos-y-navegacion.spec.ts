import { BRAND } from "@job-search-os/pipeline";
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

  test("en el celular no hay «Menú»: las pestañas de abajo marcan la sección (C9-7)", async ({
    page,
  }) => {
    await login(page);
    // El recorrido de todas las secciones está en el e2e 113
    await expect(page.getByTestId("menu-movil")).toHaveCount(0);
    const tabs = page.getByRole("navigation", { name: "Secciones" });
    await expect(tabs).toBeVisible();
    await expect(tabs.getByRole("link", { name: "Hoy", exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(await scrollWidth(page)).toBeLessThanOrEqual(360);
  });

  test("header tinta: el logo lleva a /hoy y el avatar con iniciales a «Tu perfil» (C7-5)", async ({
    page,
  }) => {
    await login(page);
    const header = page.locator("header");
    await expect(header.getByRole("link", { name: BRAND.name, exact: true })).toHaveAttribute(
      "href",
      "/hoy",
    );
    const avatar = header.getByRole("link", { name: /^Perfil/ });
    await expect(avatar).toHaveAttribute("href", "/settings/perfil");
    await expect(avatar).toHaveText(/^\p{Lu}{1,2}$/u);
    // El header es índigo en claro y en oscuro
    await expect(header).toHaveCSS("background-color", "rgb(30, 27, 75)");
    // El chip de soporte no tapa el último botón: la página deja lugar abajo
    const box = await page.getByRole("button", { name: "¿Algo no anduvo?" }).boundingBox();
    expect(box?.width ?? 0).toBeLessThanOrEqual(48);
  });

  test("en pantalla ancha la nav son las cinco secciones y «Sin descripción» marca Ofertas (C10-3, R5-C9)", async ({
    page,
  }) => {
    await login(page);
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto("/jobs/pending-jd");
    const nav = page.getByRole("navigation", { name: "Secciones" });
    await expect(nav).toBeVisible();
    await expect(page.getByTestId("tabbar")).toBeHidden();
    await expect(nav.getByRole("link")).toHaveCount(5);
    // R5-C9 (hallazgo 19): «Sin descripción» es trabajo con las ofertas, marca Ofertas y no Perfil
    await expect(nav.getByRole("link", { name: "Ofertas", exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(nav.getByRole("link", { name: "Perfil", exact: true })).not.toHaveAttribute(
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
    await expect(page.getByRole("heading", { name: "A tu favor" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Te falta o te frena" })).toBeVisible();
    await expect(page.locator("body")).not.toContainText(OLD_TEXTS);
    // A-10: el detalle del puntaje queda plegado en «Cómo se calculó»
    await expect(page.getByText("Puntaje de la IA")).toBeHidden();
    await page.getByText("Cómo se calculó", { exact: true }).click();
    await expect(page.getByText("Puntaje de la IA")).toBeVisible();
    await expect(page.getByText("Puntaje final")).toBeVisible();

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
    await expect(box.getByRole("link", { name: "Ver las ofertas sin evaluar" })).toHaveAttribute(
      "href",
      "/jobs?estado=prefiltrada",
    );
    await expect(box).toContainText(/Tenés (1 oferta|\d+ ofertas) sin descripción/);
    await expect(
      box.getByRole("link", { name: /Completar (la descripción|las descripciones)/ }),
    ).toHaveAttribute("href", "/jobs/pending-jd");
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
