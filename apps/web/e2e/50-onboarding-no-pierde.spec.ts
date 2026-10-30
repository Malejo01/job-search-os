import * as s from "@job-search-os/db/schema";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { eq, sql } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";
// Import relativo directo (no el índice de @job-search-os/db, que arrastra import.meta)
import { deleteUserData } from "../../../packages/db/src/user-tables";
import { E2E_USER_ID, chooseRoles, ownerDb } from "./helpers";

/**
 * Flujo 50 (ronda 77): el paso 1 del onboarding no pierde lo cargado ante un error. Una persona
 * nueva marca puestos, país, inglés, años y modalidad, pega un resumen de más de 2000 caracteres
 * con saltos de línea y guarda: no navega, el error queda junto al resumen y nada se borra.
 * Recorta y guarda. El segundo caso es la regresión del \r\n: 1990 caracteres con muchos saltos
 * (el navegador los envía como \r\n y antes pasaban de 2000) guardan sin error.
 * Todo el texto es inventado; las personas se borran al final con deleteUserData.
 */
test.describe.configure({ mode: "serial" });

const MAX = 2000;

/** Texto ficticio de exactamente `n` caracteres, con un salto de línea cada 30 y sin terminar en uno. */
function resumen(n: number): string {
  return "Perfil ficticio de prueba 50.\n".repeat(Math.ceil(n / 30)).slice(0, n - 1) + "x";
}

type Persona = {
  email: string;
  code: string;
  invitationId: string;
  context: BrowserContext;
  page: Page;
};

test.describe("Flujo 50: el onboarding no pierde lo cargado", () => {
  const tag = Date.now();
  const password = "onboarding-clave-local-50";
  const personas: Persona[] = [];

  async function crearPersona(browser: Browser, name: string): Promise<Persona> {
    const email = `${name}-${tag}@onboarding.test`;
    const code = randomBytes(32).toString("base64url");
    const codeHash = createHash("sha256").update(code).digest("hex");
    const { db, close } = ownerDb();
    let invitationId: string;
    try {
      const [row] = await db
        .insert(s.invitations)
        .values({ codeHash, email, createdByUserId: E2E_USER_ID })
        .returning({ id: s.invitations.id });
      invitationId = row!.id;
    } finally {
      await close();
    }
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    const persona = { email, code, invitationId, context, page };
    personas.push(persona);
    await page.goto(`/register?code=${code}`);
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Nombre (opcional)").fill("Persona Onboarding");
    await page.getByLabel("Contraseña", { exact: true }).fill(password);
    await page.getByLabel("Repetí la contraseña").fill(password);
    await page.getByLabel(/Leí y acepto/).check();
    await page.getByRole("button", { name: "Crear cuenta" }).click();
    // El registro deja la sesión iniciada: va directo al onboarding
    await page.waitForURL("**/onboarding**");
    return persona;
  }

  /** Puestos, país, inglés, años y modalidad: todo menos el resumen. */
  async function cargarDatos(page: Page) {
    await chooseRoles(page, ["fullstack", "qa"]);
    await page.getByLabel(/País de residencia/).fill("UY");
    await page.getByRole("option", { name: /\(UY\)/ }).click();
    await page.getByLabel(/Tu nivel de inglés/).selectOption("B2");
    await page.getByLabel(/Años de experiencia/).fill("4");
    await page.getByRole("checkbox", { name: "Remoto" }).check();
  }

  // Cada paso de la limpieza por separado: si uno falla, los demás igual corren
  test.afterAll(async () => {
    for (const p of personas) {
      await p.context.close().catch(() => {});
      const { db, close } = ownerDb();
      try {
        const [user] = await db
          .select({ id: s.users.id })
          .from(s.users)
          .where(eq(s.users.email, p.email));
        if (user) {
          await db
            .transaction(async (tx) => {
              await tx.execute(sql`select set_config('app.user_id', ${user.id}, true)`);
              await deleteUserData(tx as never, user.id);
            })
            .catch(() => {});
          // La primera ingesta corre en `after()` y puede escribir después del borrado
          await db.delete(s.jobs).where(eq(s.jobs.userId, user.id));
        }
        await db.delete(s.invitations).where(eq(s.invitations.id, p.invitationId));
      } finally {
        await close();
      }
    }
  });

  test("un resumen de más de 2000 caracteres da error junto al campo y no borra nada", async ({
    browser,
  }) => {
    const { page } = await crearPersona(browser, "pasado");
    await cargarDatos(page);
    const resumenInput = page.getByLabel(/Resumen de tu perfil/);
    await resumenInput.fill(resumen(2050));

    // Contador en rojo con el aviso
    const contador = page.getByTestId("summary-counter");
    await expect(contador).toContainText("50 de más");
    await expect(contador).toHaveClass(/text-red-700/);

    await page.getByRole("button", { name: "Guardar y continuar" }).click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText("te pasaste por 50");
    await expect(page).toHaveURL(/\/onboarding(\?|$)/);
    await expect(resumenInput).toBeFocused();
    await expect(resumenInput).toHaveAttribute("aria-invalid", "true");

    // Nada se perdió
    await expect(page.locator('input[name="targetRoles"]:checked')).toHaveCount(2);
    await expect(page.getByRole("list", { name: "Países elegidos" })).toContainText("(UY)");
    await expect(page.getByLabel(/Tu nivel de inglés/)).toHaveValue("B2");
    await expect(page.getByLabel(/Años de experiencia/)).toHaveValue("4");
    await expect(page.getByRole("checkbox", { name: "Remoto" })).toBeChecked();

    // Recortado, guarda
    await resumenInput.fill(resumen(1500));
    await expect(contador).not.toContainText("te pasaste");
    await page.getByRole("button", { name: "Guardar y continuar" }).click();
    await page.waitForURL("**/onboarding/skills**");
  });

  test("1990 caracteres con muchos saltos de línea guardan sin error (regresión \\r\\n)", async ({
    browser,
  }) => {
    const { page } = await crearPersona(browser, "justo");
    await cargarDatos(page);
    const texto = resumen(MAX - 10);
    expect(texto.split("\n").length).toBeGreaterThan(30);
    await page.getByLabel(/Resumen de tu perfil/).fill(texto);
    await expect(page.getByTestId("summary-counter")).toContainText(`${MAX - 10} / ${MAX}`);
    await page.getByRole("button", { name: "Guardar y continuar" }).click();
    await page.waitForURL("**/onboarding/skills**");
  });
});
