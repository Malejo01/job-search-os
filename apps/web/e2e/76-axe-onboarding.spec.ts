import AxeBuilder from "@axe-core/playwright";
import * as s from "@job-search-os/db/schema";
import { expect, test, type Page } from "@playwright/test";
import { eq, sql } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";
// Import relativo directo (no el índice de @job-search-os/db, que arrastra import.meta)
import { deleteUserData } from "../../../packages/db/src/user-tables";
import { E2E_USER_ID, chooseRoles, ownerDb } from "./helpers";

/**
 * Flujo 76 (C-4b): accesibilidad (axe, WCAG 2.0/2.1 A y AA) del registro y del onboarding, con una
 * sola persona inventada registrada por invitación (como el e2e 74). Solo mide: no cambia
 * pantallas. Mismo patrón que `70-axe-sesion.spec.ts`. Todo inventado; se limpia al final.
 *
 * Recorrido (serial): /register?code=… · /onboarding (vacío y con error de validación) ·
 * /onboarding/skills · /onboarding/ofertas (sin pool: estado vacío) · /onboarding/asistente.
 */
const CAREER = "customer_success";
const WIDE = { width: 1280, height: 800 } as const;
const NARROW = { width: 360, height: 740 } as const;

test.describe.configure({ mode: "serial" });

test.describe("Flujo 76: axe en el registro y el onboarding", () => {
  const tag = Date.now();
  const email = `axe-onboarding-${tag}@example.com`;
  // Aleatoria en cada corrida: los escaneos de secretos del CI marcan cualquier literal
  const secret = randomBytes(18).toString("base64url");

  let code: string;
  let invitationId: string | undefined;
  let page: Page;

  /** Axe a un ancho, con el resumen `id (impact): targets`, y sin scroll horizontal. */
  async function check(label: string, size: { width: number; height: number }) {
    await page.setViewportSize(size);
    const { violations } = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    // Regla, impacto y selectores; nunca el HTML entero
    const resumen = violations.map(
      (v) =>
        `${v.id} (${v.impact ?? "sin impacto"}): ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`,
    );
    expect(resumen, `${label} a ${size.width} px`).toEqual([]);
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth, `${label}: scrollWidth a ${size.width} px`).toBeLessThanOrEqual(size.width);
  }

  async function checkBoth(label: string) {
    await check(label, NARROW);
    await check(label, WIDE);
  }

  test.beforeAll(async ({ browser }) => {
    // Igual que createInvitation (lib/invitations.ts): código aleatorio, en la base solo su sha256
    code = randomBytes(32).toString("base64url");
    const codeHash = createHash("sha256").update(code).digest("hex");
    const { db, close } = ownerDb();
    try {
      const [row] = await db
        .insert(s.invitations)
        .values({ codeHash, email, createdByUserId: E2E_USER_ID })
        .returning({ id: s.invitations.id });
      invitationId = row!.id;
    } finally {
      await close();
    }
    const context = await browser.newContext({ viewport: WIDE });
    page = await context.newPage();
  });

  // Cada paso de la limpieza por separado: si uno falla, los demás igual corren
  test.afterAll(async () => {
    const context = page?.context();
    await context?.close().catch(() => {});
    const { db, close } = ownerDb();
    try {
      const [user] = await db
        .select({ id: s.users.id })
        .from(s.users)
        .where(eq(s.users.email, email))
        .catch(() => []);
      const id = user?.id;
      if (id) {
        await db
          .transaction(async (tx) => {
            await tx.execute(sql`select set_config('app.user_id', ${id}, true)`);
            await deleteUserData(tx as never, id);
          })
          .catch(() => {});
        // Lo que corre en `after()` al guardar el perfil puede escribir después del borrado
        await db
          .delete(s.jobs)
          .where(eq(s.jobs.userId, id))
          .catch(() => {});
      }
      if (invitationId) {
        await db
          .delete(s.invitations)
          .where(eq(s.invitations.id, invitationId))
          .catch(() => {});
      }
    } finally {
      await close().catch(() => {});
    }
  });

  test("/register?code=… antes de completar el formulario", async () => {
    await page.goto(`/register?code=${code}`);
    await expect(page.getByLabel("Email")).toBeVisible();
    await page.waitForLoadState("networkidle");
    await checkBoth("/register");
  });

  test("registro y entrada a /onboarding", async () => {
    await page.setViewportSize(WIDE);
    await page.goto(`/register?code=${code}`);
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Contraseña", { exact: true }).fill(secret);
    await page.getByLabel("Repetí la contraseña").fill(secret);
    await page.getByLabel(/Leí y acepto/).check();
    await page.getByRole("button", { name: "Crear cuenta" }).click();
    // Con el #199 el registro entra solo y va a /onboarding; sin él pasa por «Cuenta creada» y el
    // login. El spec sirve con los dos flujos: no mide nada en el medio.
    const created = page.getByRole("heading", { name: "Cuenta creada" });
    await page.waitForURL(/\/(onboarding|register)/);
    await expect(created.or(page.getByText("Paso 1 de 3"))).toBeVisible();
    if (await created.isVisible()) {
      await page.getByRole("link", { name: /Iniciar sesión|Ir a entrar/ }).click();
      await page.waitForURL("**/login**");
      await page.getByLabel("Email").fill(email);
      await page.getByLabel("Contraseña").fill(secret);
      await page.getByRole("button", { name: "Entrar" }).click();
    }
    await page.waitForURL("**/onboarding**");
  });

  test("/onboarding (paso 1): vacío", async () => {
    await page.goto("/onboarding");
    await expect(page.locator("h1").first()).toBeVisible();
    await page.waitForLoadState("networkidle");
    await checkBoth("/onboarding vacío");
  });

  test("/onboarding (paso 1): con un error de validación a la vista", async () => {
    await page.setViewportSize(WIDE);
    await page.goto("/onboarding");
    await chooseRoles(page, [CAREER]);
    await expect(page.locator(`input[name="targetRoles"][value="${CAREER}"]`)).toBeChecked();
    await page.getByLabel(/País de residencia/).fill("BR");
    await page.getByRole("option", { name: /\(BR\)/ }).click();
    await page.getByLabel(/Tu nivel de inglés/).selectOption("C1");
    await page.getByLabel(/Años de experiencia/).fill("4");
    // Resumen corto: el formulario lo frena en el cliente y muestra el mensaje
    await page.getByLabel(/Resumen de tu perfil/).fill("Corto.");
    await page.getByRole("checkbox", { name: "Remoto" }).check();
    await page.getByRole("button", { name: "Guardar y continuar" }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: "El resumen necesita al menos" }),
    ).toBeVisible();
    await checkBoth("/onboarding con error de validación");
  });

  test("/onboarding/skills (paso 2)", async () => {
    await page.setViewportSize(WIDE);
    await page
      .getByLabel(/Resumen de tu perfil/)
      .fill(
        "Perfil ficticio de la prueba de accesibilidad: atención y éxito de clientes con cuatro años de experiencia.",
      );
    await page.getByRole("button", { name: "Guardar y continuar" }).click();
    await page.waitForURL("**/onboarding/skills**");
    await expect(page.locator("h1").first()).toBeVisible();
    await page.waitForLoadState("networkidle");
    await checkBoth("/onboarding/skills");
  });

  test("/onboarding/ofertas (paso 3, sin pool: estado vacío)", async () => {
    await page.setViewportSize(WIDE);
    await page.getByRole("button", { name: "Saltear por ahora" }).click();
    await page.waitForURL("**/onboarding/ofertas**");
    await expect(page.getByRole("heading", { name: "Tus primeras ofertas" })).toBeVisible();
    await checkBoth("/onboarding/ofertas");
  });

  test("/onboarding/asistente, con el modal de privacidad si se abre solo", async () => {
    await page.setViewportSize(WIDE);
    await page.goto("/onboarding/asistente");
    await expect(page.locator("h1").first()).toBeVisible();
    // El modal se abre solo la primera vez (showModal en un efecto); si no, se mide sin él
    await page
      .locator("dialog[open]")
      .waitFor({ state: "visible", timeout: 5_000 })
      .catch(() => {});
    await check("/onboarding/asistente", WIDE);
  });
});
