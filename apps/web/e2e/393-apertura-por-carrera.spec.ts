import * as s from "@job-search-os/db/schema";
import { expect, test, type Page } from "@playwright/test";
import { eq, like } from "drizzle-orm";
import { borrarPersonaAlta, crearPersonaAlta, entrarComo, type PersonaAlta } from "./alta-helpers";
import { E2E_EMAIL, login, ownerDb } from "./helpers";
import { ensureSeedPerson } from "./persona-qa";

/**
 * Flujos 393 y 394 (R32-03): apertura por carrera. 393, el panel `/admin/carreras` (solo admin): con la lista vacía
 * todo figura cerrado, abrir y cerrar dejan quién y cuándo, y repetir no escribe dos veces. 394, lo que ve la
 * gente: quien se anota de una carrera cerrada lee el aviso de la lista de espera y de una abierta, el de siempre;
 * una cuenta anterior sigue adentro aunque su carrera esté cerrada. «Otra» nunca figura abierta. Todo inventado; la
 * lista de carreras abiertas se vacía al empezar y al terminar.
 */
test.describe.configure({ mode: "serial" });

const tag = Date.now();

async function vaciarApertura(): Promise<void> {
  const { db, close } = ownerDb();
  try {
    await db.delete(s.openCareers);
    await db.delete(s.careerOpeningEvents);
  } finally {
    await close();
  }
}

test.describe("Flujo 393: panel de apertura por carrera", () => {
  test.skip(!process.env.ADMIN_EMAILS, "sin ADMIN_EMAILS la cuenta del e2e no es admin");
  test.use({ viewport: { width: 390, height: 844 } });

  test.beforeAll(async () => {
    await ensureSeedPerson();
    await vaciarApertura();
  });
  test.afterAll(vaciarApertura);

  test("con la lista vacía todo está cerrado; abrir y cerrar quedan en el historial", async ({
    page,
  }) => {
    await login(page);
    await page.goto("/admin/carreras");
    await expect(
      page.getByRole("heading", { name: "Apertura por carrera", level: 1 }),
    ).toBeVisible();
    // Las ocho de la beta, todas cerradas, y «Otra» no figura
    await expect(page.locator("[data-abierta]")).toHaveCount(8);
    await expect(page.locator('[data-abierta="si"]')).toHaveCount(0);
    await expect(page.getByText("«Otra» nunca abre sola")).toBeVisible();
    await expect(page.getByTestId("carreras-historial-vacio")).toBeVisible();

    await page.getByRole("button", { name: "Abrir Abogacía" }).click();
    await expect(page.getByTestId("carreras-ok")).toContainText("quedó abierta");
    await expect(page.getByTestId("carrera-abogacia")).toHaveAttribute("data-abierta", "si");
    await expect(page.getByTestId("carrera-abogacia")).toContainText(E2E_EMAIL);
    await expect(page.getByTestId("carreras-historial")).toContainText(
      `${E2E_EMAIL} abrió Abogacía`,
    );

    await page.getByRole("button", { name: "Cerrar Abogacía" }).click();
    await expect(page.getByTestId("carreras-ok")).toContainText("quedó cerrada");
    await expect(page.getByTestId("carrera-abogacia")).toHaveAttribute("data-abierta", "no");
    const historial = page.getByTestId("carreras-historial").getByRole("listitem");
    await expect(historial).toHaveCount(2);
    await expect(historial.first()).toContainText("cerró Abogacía");

    // En la base: dos eventos, ninguna carrera abierta
    const { db, close } = ownerDb();
    try {
      expect(await db.select().from(s.careerOpeningEvents)).toHaveLength(2);
      expect(await db.select().from(s.openCareers)).toHaveLength(0);
    } finally {
      await close();
    }
  });

  test("una cuenta común no entra al panel (404)", async ({ page }) => {
    const comun: PersonaAlta = {
      id: "c0000000-0000-4000-8000-000000000395",
      email: `apertura-comun-${tag}@ejemplo.test`,
      password: "clave-e2e-apertura-local",
      name: "Persona Comun",
    };
    await crearPersonaAlta(comun, { targetRoles: ["abogacia"] });
    try {
      await entrarComo(page, comun);
      const res = await page.goto("/admin/carreras");
      expect(res?.status()).toBe(404);
    } finally {
      await borrarPersonaAlta(comun.id);
    }
  });
});

test.describe("Flujo 394: lo que ve la gente", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  const viejo: PersonaAlta = {
    id: "c0000000-0000-4000-8000-000000000396",
    email: `apertura-vieja-${tag}@ejemplo.test`,
    password: "clave-e2e-apertura-local",
    name: "Persona Anterior",
  };

  test.beforeAll(async () => {
    await vaciarApertura();
    // Cuenta anterior de una carrera que NO está abierta (la lista está vacía)
    await crearPersonaAlta(viejo, { targetRoles: ["finanzas_contabilidad"] });
  });
  test.afterAll(async () => {
    await vaciarApertura();
    await borrarPersonaAlta(viejo.id).catch(() => {});
    const { db, close } = ownerDb();
    try {
      await db.delete(s.waitlist).where(like(s.waitlist.email, `apertura-${tag}-%@example.com`));
    } finally {
      await close();
    }
  });

  async function anotarse(page: Page, n: number, carrera: string) {
    await page.goto("/acceso");
    await page.getByLabel("Nombre").fill("Persona Apertura");
    await page.getByLabel("Email").fill(`apertura-${tag}-${n}@example.com`);
    await page.getByRole("radio", { name: carrera }).check();
    await page.getByRole("button", { name: "Pedir acceso", exact: true }).click();
    await expect(page.getByTestId("acceso-confirmacion")).toBeVisible();
    return page.getByRole("status").filter({ hasText: "te anotamos" });
  }

  test("con la lista vacía, quien se anota ve el aviso de su carrera y queda anotado con ella", async ({
    page,
  }) => {
    const status = await anotarse(page, 1, "Contaduría");
    await expect(status).toContainText("Todavía estamos sumando ofertas de Contaduría");
    await expect(status).toContainText("Te avisamos por email apenas abra");
    const { db, close } = ownerDb();
    try {
      const [row] = await db
        .select({ role: s.waitlist.role })
        .from(s.waitlist)
        .where(eq(s.waitlist.email, `apertura-${tag}-1@example.com`));
      expect(row?.role).toBe("finanzas_contabilidad");
    } finally {
      await close();
    }
  });

  test("una carrera abierta ve el mensaje de siempre; otra carrera sigue esperando", async ({
    page,
  }) => {
    const { db, close } = ownerDb();
    try {
      await db.insert(s.openCareers).values({ career: "abogacia" });
    } finally {
      await close();
    }
    const abierta = await anotarse(page, 2, "Abogacía");
    await expect(abierta).toContainText("el cupo es limitado");
    await expect(abierta).not.toContainText("Todavía estamos sumando");
    // A 390 px /acceso muestra solo los tres primeros chips (Abogacía, Contaduría, Administración)
    const cerrada = await anotarse(page, 3, "Administración");
    await expect(cerrada).toContainText("Todavía estamos sumando ofertas de Administración");
  });

  test("quien ya estaba adentro no pierde nada aunque su carrera esté cerrada", async ({
    page,
  }) => {
    await entrarComo(page, viejo);
    await expect(page).toHaveURL(/\/hoy/);
    await page.goto("/jobs");
    await expect(page).toHaveURL(/\/jobs/);
    await expect(page.getByRole("main")).toBeVisible();
    await expect(page.getByTestId("carrera-pedida")).toHaveCount(0);
  });
});
