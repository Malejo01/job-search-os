import * as s from "@job-search-os/db/schema";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { eq, sql } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";
// Import relativo directo (no el índice de @job-search-os/db, que arrastra import.meta)
import { deleteUserData } from "../../../packages/db/src/user-tables";
import { E2E_USER_ID, chooseRoles, ownerDb, skillLevelsOf } from "./helpers";

/**
 * Flujo 51 (ronda 78): el paso de skills. Una persona nueva (invitación sembrada, registro y paso 1
 * como en el 26) elige su nivel de inglés en el paso de skills, abre «¿Qué es?» de una skill (y lo
 * cierra con Escape), y agrega una skill que no está en la lista: la guarda con su nivel y la quita.
 * Todo con datos inventados; la persona se borra al final con deleteUserData.
 */
test.describe.configure({ mode: "serial" });

const PROYECTO = "lo usé en un proyecto";
const NOMBRE_PROPIO = "Herramienta Ficticia";

test.describe("Flujo 51: inglés, «¿Qué es?» y skills propias", () => {
  const tag = Date.now();
  const email = `skills51-${tag}@skills.test`;
  const password = "skills-clave-local-51";

  let code: string;
  let invitationId: string | undefined;
  let userId: string | null = null;
  let context: BrowserContext;
  let page: Page;

  const englishSelect = () => page.getByLabel("Tu nivel de inglés");

  /** Skills propias de la persona, por nombre → nivel (con la conexión del dueño). */
  async function customSkillsOf(id: string): Promise<Record<string, number>> {
    const { db, close } = ownerDb();
    try {
      const rows = await db
        .select({ name: s.userSkills.name, level: s.userSkills.level })
        .from(s.userSkills)
        .where(eq(s.userSkills.userId, id));
      return Object.fromEntries(rows.map((r) => [r.name, r.level]));
    } finally {
      await close();
    }
  }

  async function profileCefr(id: string): Promise<string | null> {
    const { db, close } = ownerDb();
    try {
      const [row] = await db
        .select({ cefr: s.profiles.englishCefr })
        .from(s.profiles)
        .where(eq(s.profiles.userId, id));
      return row?.cefr ?? null;
    } finally {
      await close();
    }
  }

  test.beforeAll(async ({ browser }) => {
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
    // 360 px: el panel de «¿Qué es?» no tiene que salirse de la pantalla
    context = await browser.newContext({ viewport: { width: 360, height: 780 } });
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

  test("se registra, completa el paso 1 (inglés B1) y llega al paso de skills", async () => {
    await page.goto(`/register?code=${code}`);
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Nombre (opcional)").fill("Persona Skills Propias");
    await page.getByLabel("Contraseña", { exact: true }).fill(password);
    await page.getByLabel("Repetí la contraseña").fill(password);
    await page.getByLabel(/Leí y acepto/).check();
    await page.getByRole("button", { name: "Crear cuenta" }).click();
    // El registro deja la sesión iniciada: va directo al onboarding
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

    await chooseRoles(page, ["fullstack"]);
    await page.getByLabel(/País de residencia/).fill("BR");
    await page.getByRole("option", { name: /\(BR\)/ }).click();
    await page.getByLabel(/Tu nivel de inglés/).selectOption("B1");
    await page.getByLabel(/Años de experiencia/).fill("3");
    await page
      .getByLabel(/Resumen de tu perfil/)
      .fill(
        "Perfil ficticio de la prueba de skills propias: desarrollo web con tres años de experiencia.",
      );
    await page.getByRole("checkbox", { name: "Remoto" }).check();
    await page.getByRole("button", { name: "Guardar y continuar" }).click();

    await page.waitForURL("**/onboarding/skills**");
    await expect(page.getByRole("heading", { name: "Tus skills" })).toBeVisible();
    // El select de inglés viene con el valor del perfil y la ayuda de CEFR
    await expect(englishSelect()).toHaveValue("B1");
    await expect(page.getByText("¿Qué es CEFR?")).toBeVisible();
    // Las skills de inglés dejaron de ser filas
    await expect(page.getByTestId("skill-english_intermediate")).toHaveCount(0);
    await expect(page.getByTestId("skill-english_fluent")).toHaveCount(0);
  });

  test("elige B2 en el paso de skills, guarda y lo ve al volver", async () => {
    await englishSelect().selectOption("B2");
    await page.getByRole("button", { name: "Guardar y seguir" }).click();
    await page.waitForURL("**/onboarding/ofertas**");

    expect(await profileCefr(userId!)).toBe("B2");
    const levels = await skillLevelsOf(userId!);
    expect(levels.english_intermediate).toBe(3);
    expect(levels.english_fluent).toBe(1);

    await page.goto("/settings/skills");
    await expect(englishSelect()).toHaveValue("B2");
    await expect(page.getByTestId("skill-english_intermediate")).toHaveCount(0);
  });

  test("«¿Qué es?» abre el panel dentro de la pantalla y Escape lo cierra", async () => {
    await page.goto("/settings/skills");
    const row = page.getByTestId("skill-typescript");
    const button = row.getByRole("button", { name: "¿Qué es?" });
    await expect(button).toHaveAttribute("aria-expanded", "false");

    await button.click();
    await expect(button).toHaveAttribute("aria-expanded", "true");
    // useId puede traer «:» o símbolos que un selector `#id` no acepta
    const panel = page.locator(`[id="${await button.getAttribute("aria-controls")}"]`);
    await expect(panel).toBeVisible();
    await expect(panel).toContainText("JavaScript con tipos");
    const box = await panel.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(360);

    await page.keyboard.press("Escape");
    await expect(button).toHaveAttribute("aria-expanded", "false");
    await expect(panel).toBeHidden();
    await expect(button).toBeFocused();

    // Tocar afuera también lo cierra
    await button.click();
    await expect(panel).toBeVisible();
    await page.getByRole("heading", { name: "Mis skills" }).click();
    await expect(panel).toBeHidden();
  });

  test("una skill de la lista no se puede agregar como propia", async () => {
    await page.goto("/settings/skills");
    const search = page.getByLabel("Buscar por nombre");
    await search.fill("canva");
    // Canva está en la lista: se ofrece y no hay botón de alta propia
    await expect(page.getByRole("button", { name: "Canva" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Agregar", exact: true })).toHaveCount(0);
    // Una skill que ya tiene fila (TypeScript) no se ofrece de nuevo: al querer agregarla, avisa
    await search.fill("typescript");
    await expect(page.getByText(/No está en la lista: agregar/)).toBeVisible();
    await search.press("Enter");
    await expect(page.getByRole("alert").filter({ hasText: "ya está en la lista" })).toBeVisible();
  });

  test("agrega «Herramienta Ficticia» con Enter, le pone nivel, guarda, la ve y la quita", async () => {
    await page.goto("/settings/skills");
    const search = page.getByLabel("Buscar por nombre");
    await search.fill(`  ${NOMBRE_PROPIO}  `);
    await expect(page.getByText(`No está en la lista: agregar «${NOMBRE_PROPIO}»`)).toBeVisible();
    await search.press("Enter");

    // Sin enviar nada todavía: aparece la fila nueva y el buscador queda vacío
    await expect(search).toHaveValue("");
    const fresh = page.getByRole("group", { name: NOMBRE_PROPIO });
    await expect(fresh).toBeVisible();
    expect(await customSkillsOf(userId!)).toEqual({});

    // El nivel es obligatorio: sin elegirlo, el error va junto al campo y no se pierde la fila
    await page.getByRole("button", { name: "Guardar", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Elegí un nivel" })).toBeVisible();
    await expect(fresh).toBeVisible();

    await fresh.getByLabel(PROYECTO, { exact: true }).check();
    await page.getByRole("button", { name: "Guardar", exact: true }).click();
    await page.waitForURL("**/settings/skills?guardado=1");

    expect(await customSkillsOf(userId!)).toEqual({ [NOMBRE_PROPIO]: 2 });
    await expect(page.getByRole("heading", { name: "Tus skills agregadas" })).toBeVisible();
    const saved = page.getByRole("group", { name: NOMBRE_PROPIO });
    await expect(saved).toHaveCount(1);
    await expect(saved.getByLabel(PROYECTO, { exact: true })).toBeChecked();

    // Repetirla (aun con otras mayúsculas) no la duplica
    await page.getByLabel("Buscar por nombre").fill("herramienta ficticia");
    await page.getByLabel("Buscar por nombre").press("Enter");
    await expect(
      page.getByRole("alert").filter({ hasText: "Ya agregaste esa skill" }),
    ).toBeVisible();

    await page.getByRole("button", { name: `Quitar ${NOMBRE_PROPIO}` }).click();
    // La URL ya es ?guardado=1 desde el guardado anterior: se espera a que la fila desaparezca,
    // que pasa recién cuando la acción terminó y la página se volvió a renderizar
    await expect(page.getByRole("group", { name: NOMBRE_PROPIO })).toHaveCount(0);
    expect(await customSkillsOf(userId!)).toEqual({});

    // Ni la taxonomía global ni el nivel de otras skills se tocaron
    const { db, close } = ownerDb();
    try {
      const rows = await db
        .select({ id: s.skills.id })
        .from(s.skills)
        .where(eq(s.skills.name, NOMBRE_PROPIO));
      expect(rows).toHaveLength(0);
    } finally {
      await close();
    }
  });
});
