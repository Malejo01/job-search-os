import * as s from "@job-search-os/db/schema";
import { expect, test, type Page } from "@playwright/test";
import { like } from "drizzle-orm";
import { axeSummary } from "./axe-helpers";
import { ownerDb } from "./helpers";

/**
 * Flujo 106 (C8-3): /acceso para el salón del 11/11, en un celular de 390 px. Confirmación con el
 * próximo paso, sin prometer lugar, y «Pasáselo a alguien» con Web Share o, si no está, copiando el
 * link. La carga del salón (60 personas desde el mismo wifi) la prueba waitlist.integration.test.ts.
 */
test.describe("Flujo 106: /acceso a prueba del salón (C8-3)", () => {
  const tag = Date.now();
  test.use({ viewport: { width: 390, height: 844 } });

  test.afterAll(async () => {
    const { db, close } = ownerDb();
    try {
      await db.delete(s.waitlist).where(like(s.waitlist.email, `salon-${tag}-%@example.com`));
    } finally {
      await close();
    }
  });

  async function anotarse(page: Page, n: number) {
    await page.goto("/acceso?origen=voces-jovenes");
    await page.getByLabel("Nombre").fill("Persona Salón");
    await page.getByLabel("Email").fill(`salon-${tag}-${n}@example.com`);
    // Las carreras de la beta son chips (C10-5)
    await page.getByRole("radio", { name: "Abogacía" }).check();
    await page.getByRole("button", { name: "Pedir acceso", exact: true }).click();
    await expect(page.getByTestId("acceso-confirmacion")).toBeVisible();
  }

  test("confirmación: te escribimos si hay lugar, qué sigue y el ejemplo", async ({ page }) => {
    await anotarse(page, 1);
    const status = page.getByRole("status").filter({ hasText: "te anotamos" });
    await expect(status).toContainText("te escribimos si hay lugar");
    await expect(status).toContainText("el cupo es limitado");
    await expect(page.getByRole("heading", { name: "Qué sigue" })).toBeVisible();
    await expect(page.getByRole("link", { name: "cómo funciona con un ejemplo" })).toHaveAttribute(
      "href",
      "/demo/contaduria",
    );
    const share = page.getByRole("button", { name: "Pasáselo a alguien" });
    const box = await share.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  });

  test("con Web Share, comparte el link de /acceso con origen «compartido»", async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __shared?: ShareData };
      Object.defineProperty(navigator, "share", {
        configurable: true,
        value: async (data: ShareData) => {
          w.__shared = data;
        },
      });
    });
    await anotarse(page, 2);
    await page.getByRole("button", { name: "Pasáselo a alguien" }).click();
    const shared = await page.waitForFunction(
      () => (window as unknown as { __shared?: ShareData }).__shared,
    );
    const data = (await shared.jsonValue()) as ShareData;
    expect(data.url).toMatch(/\/acceso\?origen=compartido$/);
    expect(data.text).toContain("cupo es limitado");
  });

  test("sin Web Share, copia el link y lo avisa", async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __copied?: string };
      Object.defineProperty(navigator, "share", { configurable: true, value: undefined });
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (text: string) => {
            w.__copied = text;
          },
        },
      });
    });
    await anotarse(page, 3);
    await page.getByRole("button", { name: "Pasáselo a alguien" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Copiamos el link" })).toBeVisible();
    const copied = await page.evaluate(() => (window as unknown as { __copied?: string }).__copied);
    expect(copied).toContain("/acceso?origen=compartido");
  });

  test("sin Web Share ni portapapeles, muestra el link para copiarlo a mano", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "share", { configurable: true, value: undefined });
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async () => {
            throw new Error("bloqueado");
          },
        },
      });
    });
    await anotarse(page, 4);
    await page.getByRole("button", { name: "Pasáselo a alguien" }).click();
    await expect(page.getByLabel("Link para compartir")).toHaveValue(
      /\/acceso\?origen=compartido$/,
    );
  });

  for (const tema of ["claro", "oscuro"] as const) {
    test(`la confirmación sin violaciones de axe (${tema})`, async ({ page }) => {
      if (tema === "oscuro") {
        await page.addInitScript(() => localStorage.setItem("jso-tema", "oscuro"));
      }
      await anotarse(page, tema === "claro" ? 5 : 6);
      const { violations, unmeasured } = await axeSummary(page);
      expect(violations).toEqual([]);
      expect(unmeasured).toEqual([]);
    });
  }
});
