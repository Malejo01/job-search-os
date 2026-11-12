import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import {
  cleanup,
  completeStep1,
  createInvitation,
  fillSkills,
  finding,
  newRun,
  register,
  seedAndEvaluate,
  seedPool,
} from "./personas/flow";
import type { PersonaKey } from "./personas/personas";

/**
 * Flujo 126 (C12, R5): QA por carrera, una persona ficticia por cada una de las 8 carreras de la beta.
 * Por persona: el chip de /acceso y la carrera que guarda, registro con invitación, onboarding, ofertas
 * evaluadas (worker demo, sin LLM), /hoy, /jobs, el detalle de una oferta, Tu perfil, Tu CV y la ayuda.
 * Celular de 390 px salvo /acceso (1280 px, donde se ven los 8 chips sin «+3»).
 *
 * Hallazgo conocido sobre main (lo arregla C3): el chip «Relaciones públicas» guarda `marketing_digital`
 * y «Programación» guarda `fullstack`. Cuando C3 cambie la clave guardada, ajustar `savedRole`.
 * Informes en docs/beta/qa-carreras/.
 */
type Carrera = {
  key: PersonaKey;
  nombre: string;
  /** `key` del chip en /acceso (value del radio `carrera-chip`) y su texto. */
  chip: { key: string; label: string };
  /** Carrera que guarda el chip en el campo oculto `role` (hoy, sobre main). */
  savedRole: string;
  /** Lo que se espera que guarde una vez que C3 la tenga como carrera propia (hallazgo si difiere). */
  expectedRole: string;
};

const CARRERAS: Carrera[] = [
  {
    key: "mariana",
    nombre: "abogacía",
    chip: { key: "abogacia", label: "Abogacía" },
    savedRole: "abogacia",
    expectedRole: "abogacia",
  },
  {
    key: "agustina",
    nombre: "contaduría",
    chip: { key: "finanzas_contabilidad", label: "Contaduría" },
    savedRole: "finanzas_contabilidad",
    expectedRole: "finanzas_contabilidad",
  },
  {
    key: "bruno",
    nombre: "administración",
    chip: { key: "administracion_empresas", label: "Administración" },
    savedRole: "administracion_empresas",
    expectedRole: "administracion_empresas",
  },
  {
    key: "camila",
    nombre: "comunicación",
    chip: { key: "comunicacion", label: "Comunicación" },
    savedRole: "comunicacion",
    expectedRole: "comunicacion",
  },
  {
    key: "valentina",
    nombre: "marketing",
    chip: { key: "marketing_digital", label: "Marketing" },
    savedRole: "marketing_digital",
    expectedRole: "marketing_digital",
  },
  {
    key: "rocio",
    nombre: "relaciones públicas",
    chip: { key: "relaciones_publicas", label: "Relaciones públicas" },
    savedRole: "marketing_digital",
    expectedRole: "relaciones_publicas",
  },
  {
    key: "ines",
    nombre: "relaciones internacionales",
    chip: { key: "relaciones_internacionales", label: "Relaciones internacionales" },
    savedRole: "relaciones_internacionales",
    expectedRole: "relaciones_internacionales",
  },
  {
    key: "julian",
    nombre: "programación",
    chip: { key: "programacion", label: "Programación" },
    savedRole: "fullstack",
    expectedRole: "fullstack",
  },
];

/** Captura la pantalla a 390 y 1280 px (quedan en test-results, no versionado) y vuelve a 390. */
async function shoot(page: Page, carrera: string, pantalla: string): Promise<void> {
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.screenshot({
      path: test.info().outputPath(`${carrera}-${pantalla}-${width}.png`),
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 390, height: 844 });
}

for (const carrera of CARRERAS) {
  test.describe(`Flujo 126: QA de ${carrera.nombre} (${carrera.key})`, () => {
    test.describe.configure({ mode: "serial" });
    const run = newRun(carrera.key);
    // En el flujo común solo la persona de abogacía entra por la lista de espera; acá todas entran con
    // invitación común, para recorrer el paso 1 con la carrera a elegir a mano
    run.viaWaitlist = false;
    const ownTitles = run.persona.offers.filter((o) => o.own).map((o) => o.title);
    let context: BrowserContext | undefined;
    let page: Page;
    let detailUrl = "";

    test.beforeAll(async ({ browser }) => {
      await createInvitation(run);
      await seedPool(run);
      context = await browser.newContext({ viewport: { width: 390, height: 844 } });
      page = await context.newPage();
    });

    test.afterAll(async () => {
      await cleanup(run, context);
    });

    test("/acceso: el chip existe y guarda la carrera esperada", async ({ browser }) => {
      const wide = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      try {
        const acceso = await wide.newPage();
        await acceso.goto("/acceso");
        const chip = acceso.locator(`input[name="carrera-chip"][value="${carrera.chip.key}"]`);
        await expect(chip).toHaveCount(1);
        await expect(acceso.getByText(carrera.chip.label, { exact: true }).first()).toBeVisible();
        await chip.check({ force: true });
        const saved = acceso.locator('input[type="hidden"][name="role"]');
        // Lo que hoy está mal no corta el recorrido: expect.soft junta todo
        await expect
          .soft(saved, `el chip «${carrera.chip.label}» guarda la carrera esperada`)
          .toHaveValue(carrera.expectedRole);
        const actual = await saved.inputValue();
        if (actual !== carrera.expectedRole) {
          finding(
            `/acceso: el chip «${carrera.chip.label}» guarda «${actual}» y debería guardar «${carrera.expectedRole}» (lo arregla C3)`,
          );
        }
        await shoot(acceso, carrera.key, "acceso");
      } finally {
        await wide.close();
      }
    });

    test("invitación, registro y onboarding", async () => {
      await page.goto(`/register?code=${run.code}`);
      await shoot(page, carrera.key, "registro");
      await register(page, run);
      await shoot(page, carrera.key, "onboarding-paso1");
      await completeStep1(page, run);
      await shoot(page, carrera.key, "onboarding-skills");
      await fillSkills(page, run);
      await shoot(page, carrera.key, "onboarding-ofertas");
    });

    test("/hoy, /jobs y el detalle de una oferta con su puntaje", async () => {
      await seedAndEvaluate(run);
      await page.goto("/hoy");
      await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
      await shoot(page, carrera.key, "hoy");
      await page.goto("/jobs");
      await expect(page.getByRole("heading", { name: "Tus ofertas", exact: true })).toBeVisible();
      await shoot(page, carrera.key, "jobs");
      const link = page.getByRole("link", { name: ownTitles[0]! }).first();
      await expect(link).toBeVisible({ timeout: 15_000 });
      await link.click();
      await page.waitForURL(/\/jobs\/[0-9a-f-]{36}$/);
      detailUrl = page.url();
      await expect(page.getByRole("heading", { level: 1, name: ownTitles[0]! })).toBeVisible();
      await expect(page.getByRole("img", { name: /^puntaje/ }).first()).toBeVisible();
      await shoot(page, carrera.key, "detalle");
    });

    test("no aparece la oferta de otro puesto (control negativo)", async () => {
      const control = run.persona.offers.find((o) => !o.own)!;
      await page.goto("/jobs");
      await expect(page.getByRole("heading", { name: "Tus ofertas", exact: true })).toBeVisible();
      expect(await page.content()).not.toContain(control.title);
    });

    test("Tu perfil, Tu CV y la ayuda se abren", async () => {
      await page.goto("/settings/perfil");
      await expect(page.getByRole("heading", { level: 1, name: "Tu perfil" })).toBeVisible();
      await shoot(page, carrera.key, "perfil");
      await page.goto("/cv");
      await expect(page.getByRole("heading", { level: 1, name: "Tu CV" })).toBeVisible();
      await shoot(page, carrera.key, "cv");
      await page.goto("/ayuda");
      await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
      await shoot(page, carrera.key, "ayuda");
    });

    test("el detalle sigue accesible al volver (sin error de servidor)", async () => {
      const response = await page.goto(detailUrl);
      expect(response?.status()).toBeLessThan(400);
    });
  });
}
