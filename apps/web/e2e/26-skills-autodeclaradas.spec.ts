import * as s from "@job-search-os/db/schema";
import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { eq, sql } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";
// Import relativo directo (no el índice de @job-search-os/db, que arrastra import.meta)
import { deleteUserData } from "../../../packages/db/src/user-tables";
import {
  E2E_USER_ID,
  ownerDb,
  seedMarketSnapshot,
  seedOffersWithSkills,
  skillLevelsOf,
} from "./helpers";

/**
 * Flujo 26 (ronda 28): skills autodeclaradas. Una persona nueva (invitación sembrada, registro y
 * onboarding como en el 25) saltea el paso de skills y ve en /market que todo es brecha; después
 * elige un rol en /settings/skills, carga 5 skills y /market deja de marcarlas como gap.
 * Las ofertas y sus skills son inventadas y se siembran con la conexión del dueño; la persona se
 * borra al final con deleteUserData.
 */
test.describe.configure({ mode: "serial" });

const SOLTURA = "lo uso con soltura";
const PROYECTO = "lo usé en un proyecto";

const OFFERS = [
  ["typescript", "react", "nextjs", "testing", "rest_apis", "sql"],
  ["typescript", "react", "nextjs", "testing", "rest_apis", "docker"],
  ["typescript", "react", "sql", "rest_apis", "ci_cd", "testing", "nextjs"],
];

test.describe("Flujo 26: skills autodeclaradas, del onboarding al mercado", () => {
  const tag = Date.now();
  const email = `skills-${tag}@skills.test`;
  const password = "skills-clave-local-26";

  let code: string;
  let invitationId: string | undefined;
  let userId: string | null = null;
  let context: BrowserContext;
  let page: Page;

  /** La sección "Gaps" de /market (el encabezado empieza con "Gaps"). */
  const gaps = (): Locator => page.getByTestId("market-gaps");

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
    context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    page = await context.newPage();
  });

  // Cada paso de la limpieza por separado: si uno falla, los demás igual corren
  test.afterAll(async () => {
    await context?.close().catch(() => {});
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
        // La primera ingesta y el recálculo corren en `after()` y pueden escribir después del borrado
        await db.delete(s.jobs).where(eq(s.jobs.userId, id));
      }
      if (invitationId) await db.delete(s.invitations).where(eq(s.invitations.id, invitationId));
    } finally {
      await close();
    }
  });

  test("se registra, recibe ofertas y completa el perfil: llega al paso de skills y lo saltea", async () => {
    await page.goto(`/register?code=${code}`);
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Nombre (opcional)").fill("Persona Skills");
    await page.getByLabel("Contraseña", { exact: true }).fill(password);
    await page.getByLabel("Repetí la contraseña").fill(password);
    await page.getByLabel(/Leí y acepto/).check();
    await page.getByRole("button", { name: "Crear cuenta" }).click();
    await expect(page.getByRole("heading", { name: "Cuenta creada" })).toBeVisible();
    await page.getByRole("link", { name: "Ir a entrar" }).click();
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Contraseña").fill(password);
    await page.getByRole("button", { name: "Entrar" }).click();
    await page.waitForURL("**/onboarding**");

    const { db, close } = ownerDb();
    try {
      const [user] = await db
        .select({ id: s.users.id })
        .from(s.users)
        .where(eq(s.users.email, email));
      userId = user!.id;
    } finally {
      await close();
    }

    // Antes de terminar el perfil, así el recálculo del onboarding ya las encuentra. El snapshot
    // se siembra a mano: el spec no espera a la primera ingesta (que sale a la red). Si el
    // recálculo del onboarding lo pisa, usa los mismos slugs.
    await seedOffersWithSkills(userId, tag, OFFERS);
    await seedMarketSnapshot(userId, OFFERS);

    await page.getByLabel(/País de residencia/).selectOption("BR");
    await page.getByLabel(/Inglés \(nivel CEFR\)/).selectOption("B2");
    await page.getByLabel(/Años de experiencia/).fill("3");
    await page
      .getByLabel(/Resumen de tu perfil/)
      .fill(
        "Perfil ficticio de la prueba de skills: desarrollo web con tres años de experiencia, sin experiencia en móvil ni en infraestructura.",
      );
    await page.getByRole("button", { name: "Guardar y continuar" }).click();

    await page.waitForURL("**/onboarding/skills**");
    await expect(page.getByRole("heading", { name: "Tus skills" })).toBeVisible();
    await expect(page.getByText(/Opcional\. Con tus niveles/)).toBeVisible();
    // Con los criterios de fábrica no hay rol deducido: pide elegirlo
    await expect(page.getByText(/Elegí un rol/)).toBeVisible();

    await page.getByRole("link", { name: "Saltear por ahora" }).click();
    await page.waitForURL("**/onboarding/asistente**");
    expect(await skillLevelsOf(userId)).toEqual({});
  });

  test("sin niveles, /market avisa y marca esas skills como gap", async () => {
    await page.goto("/market");
    await expect(page.getByTestId("market-sin-niveles")).toBeVisible();
    await expect(gaps()).toBeVisible();
    for (const name of ["TypeScript", "React", "Next.js", "REST APIs"]) {
      await expect(gaps()).toContainText(name);
    }
  });

  test("elige un rol, carga 5 skills (3 con soltura) y las guarda", async () => {
    await page.goto("/settings/skills");
    await expect(page.getByRole("heading", { name: "Mis skills" })).toBeVisible();
    await page.getByRole("link", { name: "Full-stack" }).click();
    await page.waitForURL("**/settings/skills?rol=fullstack");

    const row = (slug: string) => page.getByTestId(`skill-${slug}`);
    await row("typescript").getByLabel(SOLTURA, { exact: true }).check();
    await row("react").getByLabel(SOLTURA, { exact: true }).check();
    await row("nextjs").getByLabel(SOLTURA, { exact: true }).check();
    await row("testing").getByLabel(PROYECTO, { exact: true }).check();
    await row("rest_apis").getByLabel(PROYECTO, { exact: true }).check();

    // El buscador suma una skill que no es del rol
    await page.getByLabel("Buscar por nombre").fill("kube");
    await page.getByRole("button", { name: "Kubernetes" }).click();
    await row("kubernetes").getByLabel("hice un tutorial o curso", { exact: true }).check();

    await page.getByRole("button", { name: "Guardar", exact: true }).click();
    await page.waitForURL("**/settings/skills?guardado=1");
    await expect(
      page.getByText("Guardado. Tu mercado y tu plan se actualizan en unos segundos"),
    ).toBeVisible();

    expect(await skillLevelsOf(userId!)).toEqual({
      typescript: 3,
      react: 3,
      nextjs: 3,
      testing: 2,
      rest_apis: 2,
      kubernetes: 1,
    });
    // Lo guardado vuelve marcado
    await page.getByRole("link", { name: "Full-stack" }).click();
    await expect(row("typescript").getByLabel(SOLTURA, { exact: true })).toBeChecked();
  });

  test("/market ya no avisa y esas skills salen de Gaps", async () => {
    await expect(async () => {
      await page.goto("/market");
      await expect(page.getByTestId("market-sin-niveles")).toHaveCount(0, { timeout: 2_000 });
      for (const name of ["TypeScript", "React", "Next.js", "Testing automatizado", "REST APIs"]) {
        await expect(gaps()).not.toContainText(name, { timeout: 2_000 });
      }
    }).toPass({ timeout: 60_000, intervals: [2_000] });
  });

  test("/plan no incluye lo que cargó con soltura (recálculo al guardar)", async () => {
    // El recálculo corre en `after()` al guardar; el plan deja afuera las skills de nivel 3
    await expect(async () => {
      await page.goto("/plan");
      const items = page.locator("li");
      await expect(items.filter({ hasText: "SQL / PostgreSQL" })).not.toHaveCount(0, {
        timeout: 2_000,
      });
      for (const name of ["TypeScript", "React", "Next.js"]) {
        await expect(items.filter({ hasText: name })).toHaveCount(0, { timeout: 2_000 });
      }
    }).toPass({ timeout: 30_000, intervals: [2_000] });
  });

  test("Quitar borra el nivel y vuelve a 'sin dato'", async () => {
    await page.goto("/settings/skills");
    await page.getByRole("button", { name: "Quitar Kubernetes" }).click();
    await page.waitForURL("**/settings/skills?guardado=1");
    expect((await skillLevelsOf(userId!)).kubernetes).toBeUndefined();
    await expect(page.getByTestId("skill-kubernetes")).toHaveCount(0);
  });
});
