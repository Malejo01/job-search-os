import * as s from "@job-search-os/db/schema";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { eq, sql } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";
// Import relativo directo (no el índice de @job-search-os/db, que arrastra import.meta)
import { deleteUserData } from "../../../packages/db/src/user-tables";
import {
  E2E_USER_ID,
  assignSeededPoolJobs,
  chooseRoles,
  deleteSeededPublicJobs,
  login,
  ownerDb,
  seedPublicJobs,
  seedTargetRoles,
  setSeedTargetRoles,
} from "./helpers";

/**
 * Flujo 32 (ronda 45): varios puestos con tope por plan. Una persona nueva (invitación sembrada)
 * marca dos puestos en el paso 1 (el tercero queda deshabilitado), ve en «Tus primeras ofertas»
 * avisos de los dos y ninguno de un tercer puesto, y tiene una pestaña por puesto en /market. Aparte,
 * el usuario e2e principal (sin puestos) ve «Todavía no elegiste puesto» en Ajustes, guarda uno y
 * lo ve como actual; se lo deja sin puestos al final. Todo inventado, sin red: el pool se siembra.
 */
test.describe.configure({ mode: "serial" });

test.describe("Flujo 32: varios puestos", () => {
  const tag = Date.now();
  const email = `puestos-${tag}@puestos.test`;
  const password = "puestos-clave-local-32";
  const titleA = `Oferta Ficticia QA Puestos ${tag}`;
  const titleB = `Oferta Ficticia UX Puestos ${tag}`;
  const titleOther = `Oferta Ficticia Backend Puestos ${tag}`;

  let code: string;
  let invitationId: string | undefined;
  let userId: string | null = null;
  let roles: string[] = [];
  // T6: el último caso supone al usuario e2e sin puestos; se fija al empezar y se restaura al final
  let originalRoles: Awaited<ReturnType<typeof seedTargetRoles>> | null = null;
  let context: BrowserContext;
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    originalRoles = await seedTargetRoles();
    await setSeedTargetRoles({ targetRoles: [], targetRole: null });
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
    await seedPublicJobs(tag, [
      {
        title: titleA,
        company: "Empresa Ficticia 1",
        sourceKind: "getonboard_api",
        roleHints: ["qa"],
      },
      {
        title: titleB,
        company: "Empresa Ficticia 2",
        sourceKind: "remoteok",
        roleHints: ["ux_ui"],
      },
      {
        title: titleOther,
        company: "Empresa Ficticia 3",
        sourceKind: "jobicy",
        roleHints: ["backend"],
      },
    ]);
    context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    page = await context.newPage();
  });

  // Cada paso de la limpieza por separado: si uno falla, los demás igual corren
  test.afterAll(async () => {
    await context?.close().catch(() => {});
    await deleteSeededPublicJobs(tag).catch(() => {});
    const { db, close } = ownerDb();
    try {
      const [user] = await db
        .select({ id: s.users.id })
        .from(s.users)
        .where(eq(s.users.email, email));
      const id = user?.id ?? userId;
      if (id) {
        await db
          .transaction(async (tx) => {
            await tx.execute(sql`select set_config('app.user_id', ${id}, true)`);
            await deleteUserData(tx as never, id);
          })
          .catch(() => {});
        // Lo que corre en `after()` al guardar el perfil puede escribir después del borrado
        await db.delete(s.jobs).where(eq(s.jobs.userId, id));
      }
      if (invitationId) await db.delete(s.invitations).where(eq(s.invitations.id, invitationId));
      // El usuario e2e principal vuelve a los puestos que tenía antes (normalmente ninguno)
      await db
        .update(s.profiles)
        .set(originalRoles ?? { targetRoles: [], targetRole: null })
        .where(eq(s.profiles.userId, E2E_USER_ID));
    } finally {
      await close();
    }
  });

  test("en el paso 1, con dos puestos marcados el tercero queda deshabilitado", async () => {
    await page.goto(`/register?code=${code}`);
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Nombre (opcional)").fill("Persona Puestos");
    await page.getByLabel("Contraseña", { exact: true }).fill(password);
    await page.getByLabel("Repetí la contraseña").fill(password);
    await page.getByLabel(/Leí y acepto/).check();
    await page.getByRole("button", { name: "Crear cuenta" }).click();
    // El registro deja la sesión iniciada: va directo al onboarding
    await page.waitForURL("**/onboarding**");

    const count = page.getByTestId("role-picker-count");
    const third = page.locator('input[name="targetRoles"][value="backend"]');
    await expect(count).toHaveText("0 de 2 en el plan gratis");
    await expect(third).toBeEnabled();

    await chooseRoles(page, ["qa", "ux_ui"]);
    await expect(count).toHaveText("2 de 2 en el plan gratis");
    await expect(third).toBeDisabled();
    await expect(page.getByText("Más puestos con un plan pago (próximamente)")).toBeVisible();

    // Desmarcar uno vuelve a habilitar a los demás
    await page.locator('input[name="targetRoles"][value="ux_ui"]').uncheck();
    await expect(count).toHaveText("1 de 2 en el plan gratis");
    await expect(third).toBeEnabled();
    await chooseRoles(page, ["ux_ui"]);
    await expect(third).toBeDisabled();

    await page.getByLabel(/País de residencia/).fill("BR");
    await page.getByRole("option", { name: /\(BR\)/ }).click();
    await page.getByLabel(/Tu nivel de inglés/).selectOption("C1");
    await page.getByLabel(/Años de experiencia/).fill("4");
    await page
      .getByLabel(/Resumen de tu perfil/)
      .fill(
        "Perfil ficticio de la prueba de varios puestos: testing y diseño de producto con cuatro años de experiencia, sin experiencia en móvil.",
      );
    await page.getByRole("checkbox", { name: "Remoto" }).check();
    await page.getByRole("button", { name: "Guardar y continuar" }).click();
    await page.waitForURL("**/onboarding/skills**");
    await page.getByRole("button", { name: "Saltear por ahora" }).click();
    await page.waitForURL("**/onboarding/ofertas**");

    const { db, close } = ownerDb();
    try {
      const [user] = await db
        .select({
          id: s.users.id,
          targetRole: s.profiles.targetRole,
          targetRoles: s.profiles.targetRoles,
        })
        .from(s.users)
        .innerJoin(s.profiles, eq(s.profiles.userId, s.users.id))
        .where(eq(s.users.email, email));
      userId = user!.id;
      roles = user!.targetRoles;
      expect([...roles].sort()).toEqual(["qa", "ux_ui"]);
      // El principal es el primero de la lista
      expect(user!.targetRole).toBe(roles[0]);
    } finally {
      await close();
    }
  });

  test("«Tus primeras ofertas» trae avisos de los dos puestos y ninguno del tercero", async () => {
    expect(userId, "el test anterior crea a la persona").not.toBeNull();
    // Con o sin la asignación real: la ayuda no repite lo que ya esté asignado
    await assignSeededPoolJobs(userId!, tag);
    await page.goto("/onboarding/ofertas");

    await expect(page.getByText(titleA)).toBeVisible();
    await expect(page.getByText(titleB)).toBeVisible();
    expect(await page.content()).not.toContain(titleOther);
  });

  test("/market tiene una pestaña por puesto elegido y ignora un puesto ajeno", async () => {
    expect(roles).toHaveLength(2);
    const [principal, second] = roles as [string, string];
    await page.goto("/market");
    const tabs = page.getByRole("navigation", { name: "Puestos" });
    await expect(tabs.getByRole("link")).toHaveCount(2);
    await expect(tabs.locator(`a[href="/market?rol=${principal}"]`)).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(tabs.locator(`a[href="/market?rol=${second}"]`)).not.toHaveAttribute(
      "aria-current",
      "page",
    );

    await tabs.locator(`a[href="/market?rol=${second}"]`).click();
    await page.waitForURL(`**/market?rol=${second}`);
    await expect(tabs.locator(`a[href="/market?rol=${second}"]`)).toHaveAttribute(
      "aria-current",
      "page",
    );

    // Un puesto que no eligió se ignora y cae en el principal
    await page.goto("/market?rol=backend");
    await expect(
      page
        .getByRole("navigation", { name: "Puestos" })
        .locator(`a[href="/market?rol=${principal}"]`),
    ).toHaveAttribute("aria-current", "page");
  });

  test("en Ajustes, sin puestos dice «Todavía no elegiste puesto»; al guardar uno lo muestra", async ({
    browser,
  }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    try {
      const own = await ctx.newPage();
      await login(own);
      await own.goto("/settings#puesto");
      const section = own.locator("#puesto");
      await expect(section.getByTestId("current-roles")).toHaveText("Todavía no elegiste puesto");
      await expect(own.locator('#puesto input[name="targetRoles"]:checked')).toHaveCount(0);

      await chooseRoles(section, ["qa"]);
      await section.getByRole("button", { name: "Guardar puestos" }).click();
      await own.waitForURL("**/settings?puesto=guardado**");
      await expect(own.locator("#puesto").getByRole("status")).toContainText(
        "Guardado. Tus ofertas se actualizan con tus puestos.",
      );
      await expect(own.getByTestId("current-roles")).toContainText("Tus puestos actuales: ");
      await expect(own.locator('#puesto input[name="targetRoles"][value="qa"]')).toBeChecked();
    } finally {
      await ctx.close().catch(() => {});
    }
  });
});
