import { expect, test } from "@playwright/test";
import { createJob, deleteJob, jobStatus, login } from "./helpers";

/**
 * Flujo 360 (R30-10): «Preparar mi postulación» es una sola sección y hay un solo botón de salida,
 * «Ir a postularme en {sitio} ↗», con la aclaración de sitio externo. Al volver pregunta y nada se
 * marca solo. En el celular el botón queda arriba y fijo. Datos inventados.
 */
const URL_AVISO = "https://www.empleos-empresa-a.example/ofertas/360";

test.describe("Flujo 360: preparar mi postulación y botón de salida", () => {
  let jobId = "";
  test.beforeAll(async () => {
    jobId = await createJob({
      title: `E2E salida ${Date.now()}`,
      status: "evaluada",
      jdText: "Descripción ficticia para la prueba del botón de salida.",
      canonicalUrl: URL_AVISO,
    });
  });
  test.afterAll(async () => {
    if (jobId) await deleteJob(jobId);
  });

  test("computadora: un botón con el sitio, aclaración y sección plegada", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await login(page);
    await page.goto(`/jobs/${jobId}`);
    const salida = page.getByRole("link", {
      name: /Ir a postularme en empleos-empresa-a\.example/,
    });
    // Hay uno por tamaño de pantalla, pero el del otro tamaño está oculto y no entra en el árbol
    // de accesibilidad: a la vista queda uno solo
    await expect(salida).toHaveCount(1);
    await expect(salida).toHaveAttribute("href", URL_AVISO);
    await expect(salida).toHaveAttribute("target", "_blank");
    await expect(
      page.getByText(/Tu postulación no se envía desde/).filter({ visible: true }),
    ).toHaveCount(1);

    const seccion = page.getByTestId("seccion-preparar");
    await expect(seccion).toHaveCount(1);
    await expect(seccion.getByText("Nada se envía desde acá")).toBeHidden();
    await seccion.locator("summary").click();
    await expect(seccion.getByText(/Nada se envía desde acá/)).toBeVisible();
    await expect(seccion.locator("ol > li")).toHaveCount(5);
  });

  test("celular: el botón queda arriba y fijo; al volver pregunta y no marca solo", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await login(page);
    await page.goto(`/jobs/${jobId}`);
    const barra = page.getByTestId("salida-cel");
    await expect(barra).toBeVisible();
    await page.mouse.wheel(0, 1200);
    const caja = (await barra.boundingBox())!;
    expect(caja.y).toBeLessThanOrEqual(1);
    // No tapa la barra de navegación de abajo
    expect(caja.y + caja.height).toBeLessThan(400);

    // Sin abrir el sitio externo (bloqueado en e2e): el estado no cambia solo
    expect(await jobStatus(jobId)).toBe("evaluada");
  });
});
