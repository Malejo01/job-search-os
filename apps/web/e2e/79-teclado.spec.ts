import * as s from "@job-search-os/db/schema";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { and, eq, inArray, sql } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";
// Import relativo directo (no el índice de @job-search-os/db, que arrastra import.meta)
import { deleteUserData } from "../../../packages/db/src/user-tables";
import {
  E2E_USER_ID,
  createEvaluation,
  createJob,
  deleteJob,
  deleteSeededPublicJobs,
  evaluationFeedbackOf,
  login,
  ownerDb,
  seedPublicJobs,
  seedTargetRoles,
  setSeedTargetRoles,
} from "./helpers";

/**
 * Flujo 79 (U5): navegación solo con teclado en los flujos principales. Nada de `click()` ni de
 * `fill()` en los pasos que se prueban: solo `keyboard.press`, `keyboard.type` y `insertText`.
 * Lo que sí usa la conexión del dueño (siembra y limpieza) y el registro de la cuenta nueva, que es
 * preparación y no lo que se mide.
 *
 * Cubre: link «Saltar al contenido», /jobs -> detalle -> 👍/👎, /plan («Simular <skill>» y horas) y
 * el paso 1 del onboarding con una cuenta propia. En cada parada se verifica que el foco se vea
 * (`outline` o `box-shadow` distintos de `none` en el elemento activo).
 *
 * Datos inventados. El plan reproduce la siembra del spec 73 con la misma carrera (`soporte_it`):
 * el impacto de /plan se cachea 30 minutos por persona y carrera, así que los dos specs comparten
 * entrada de caché; este solo necesita que existan los botones, que están con cualquiera de las dos
 * siembras. En local, reiniciá `next dev` entre corridas.
 */
test.describe.configure({ mode: "serial" });

const PLAN_CAREER = "soporte_it";
const LEVELS: Record<string, number> = { sql: 2, excel: 3, python: 1, power_bi: 1, tableau: 1 };
const PLAN: { slug: string; priority: number }[] = [
  { slug: "power_bi", priority: 3 },
  { slug: "tableau", priority: 2 },
  { slug: "python", priority: 1 },
];
const ONBOARDING_CAREER = "customer_success";
const WIDE = { width: 1280, height: 800 } as const;

/** Tope de Tab para llegar a un elemento: sobra para una página entera, incluida la vuelta. */
const MAX_TABS = 250;

type Skill = { slug: string; isMust: boolean };

/** 12 avisos ficticios: 6 que ya calzan y 6 que dependen de power_bi, tableau y python. */
function planPool(tag: number): { title: string; skills: Skill[] }[] {
  const out: { title: string; skills: Skill[] }[] = [];
  const add = (n: number, label: string, skills: Skill[]) => {
    for (let i = 1; i <= n; i += 1) {
      out.push({ title: `Analista de Soporte IT Ficticio ${label}${i} ${tag}`, skills });
    }
  };
  add(6, "A", [
    { slug: "sql", isMust: true },
    { slug: "excel", isMust: false },
  ]);
  add(3, "B", [
    { slug: "sql", isMust: false },
    { slug: "power_bi", isMust: true },
  ]);
  add(2, "C", [
    { slug: "sql", isMust: false },
    { slug: "tableau", isMust: false },
  ]);
  add(1, "D", [
    { slug: "sql", isMust: false },
    { slug: "python", isMust: false },
  ]);
  return out;
}

/** Aprieta Tab hasta que `target` tenga el foco. Devuelve cuántas veces hizo falta. */
async function tabTo(page: Page, target: Locator, label: string): Promise<number> {
  await target.waitFor({ state: "attached" });
  for (let presses = 1; presses <= MAX_TABS; presses += 1) {
    await page.keyboard.press("Tab");
    const focused = await target
      .evaluate((el) => el === el.ownerDocument.activeElement)
      .catch(() => false);
    if (focused) return presses;
  }
  throw new Error(`«${label}» no se alcanza con Tab (${MAX_TABS} intentos)`);
}

/**
 * ¿Se ve el foco? `outline` (también el `auto` del navegador) o `box-shadow` (los `ring` de
 * Tailwind) distintos de `none`. Devuelve una descripción corta del elemento para el mensaje.
 */
async function focusState(page: Page): Promise<{ visible: boolean; who: string }> {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return { visible: false, who: "body (sin foco)" };
    const css = getComputedStyle(el);
    // Un contorno blanco o transparente sobre la página blanca no se ve: no cuenta
    const invisibleColor = /^rgba?\(255, 255, 255(, 1)?\)$|^rgba\(0, 0, 0, 0\)$|^transparent$/;
    const outline =
      css.outlineStyle !== "none" &&
      css.outlineStyle !== "hidden" &&
      (css.outlineStyle === "auto" || parseFloat(css.outlineWidth) > 0) &&
      (css.outlineStyle === "auto" || !invisibleColor.test(css.outlineColor));
    const shadow = css.boxShadow !== "none";
    const name = el.getAttribute("aria-label") ?? el.getAttribute("name") ?? el.id ?? "";
    return {
      visible: outline || shadow,
      who: `${el.tagName.toLowerCase()}${name ? ` «${name}»` : ""}`,
    };
  });
}

async function expectFocusVisible(page: Page, step: string): Promise<void> {
  const { visible, who } = await focusState(page);
  expect(visible, `foco invisible en «${step}»: ${who}`).toBe(true);
}

/** Tab hasta el elemento, verifica que lo tenga y que se vea. */
async function reach(page: Page, target: Locator, step: string): Promise<void> {
  await tabTo(page, target, step);
  await expect(target, `«${step}» con foco`).toBeFocused();
  await expectFocusVisible(page, step);
}

test.describe("Flujo 79: navegación solo con teclado", () => {
  const tag = Date.now();
  const planTag = tag;
  const jobTitle = `E2E teclado oferta ${tag}`;
  const email = `teclado-${tag}@example.com`;
  // Aleatoria en cada corrida: los escaneos de secretos del CI marcan cualquier literal
  const secret = randomBytes(18).toString("base64url");

  let jobId = "";
  let code = "";
  let invitationId: string | undefined;
  let originalRoles: Awaited<ReturnType<typeof seedTargetRoles>> | null = null;
  let levelsBackup: (typeof s.skillLevels.$inferSelect)[] = [];
  let planBackup: (typeof s.learningPlanItems.$inferSelect)[] = [];

  test.beforeAll(async () => {
    // 1. Oferta propia con evaluación, para el 👍/👎. Score alto: queda arriba de la lista
    jobId = await createJob({ title: jobTitle, status: "evaluada" });
    await createEvaluation(jobId, { score: 10 });

    // 2. Invitación propia (como createInvitation: en la base solo el sha256 del código)
    code = randomBytes(32).toString("base64url");
    const codeHash = createHash("sha256").update(code).digest("hex");
    originalRoles = await seedTargetRoles();
    const slugs = Object.keys(LEVELS);
    const { db, close } = ownerDb();
    try {
      const [row] = await db
        .insert(s.invitations)
        .values({ codeHash, email, createdByUserId: E2E_USER_ID })
        .returning({ id: s.invitations.id });
      invitationId = row!.id;

      // 3. Niveles y plan de aprendizaje del usuario e2e, con copia para restaurar
      const skillRows = await db
        .select({ id: s.skills.id, slug: s.skills.slug })
        .from(s.skills)
        .where(inArray(s.skills.slug, slugs));
      if (skillRows.length !== slugs.length) throw new Error("faltan skills en la taxonomía");
      const idOf = new Map(skillRows.map((r) => [r.slug, r.id]));
      const ids = skillRows.map((r) => r.id);
      levelsBackup = await db
        .select()
        .from(s.skillLevels)
        .where(and(eq(s.skillLevels.userId, E2E_USER_ID), inArray(s.skillLevels.skillId, ids)));
      await db
        .delete(s.skillLevels)
        .where(and(eq(s.skillLevels.userId, E2E_USER_ID), inArray(s.skillLevels.skillId, ids)));
      await db.insert(s.skillLevels).values(
        slugs.map((slug) => ({
          userId: E2E_USER_ID,
          skillId: idOf.get(slug)!,
          level: LEVELS[slug]!,
          confidence: 0.8,
          state: "respaldada" as const,
        })),
      );
      planBackup = await db
        .select()
        .from(s.learningPlanItems)
        .where(eq(s.learningPlanItems.userId, E2E_USER_ID));
      await db.delete(s.learningPlanItems).where(eq(s.learningPlanItems.userId, E2E_USER_ID));
      await db.insert(s.learningPlanItems).values(
        PLAN.map((p) => ({
          userId: E2E_USER_ID,
          skillId: idOf.get(p.slug)!,
          priority: p.priority,
          status: "pendiente",
        })),
      );
    } finally {
      await close();
    }

    // 4. Pool ficticio de la carrera del plan, abierto a cualquier país (el usuario e2e es de AR)
    const poolIds = await seedPublicJobs(
      planTag,
      planPool(planTag).map((p) => ({
        title: p.title,
        company: "Empresa Ficticia 1",
        sourceKind: "getonboard_api" as const,
        roleHints: [PLAN_CAREER],
        skills: p.skills,
      })),
    );
    const owner = ownerDb();
    try {
      await owner.db
        .update(s.publicJobs)
        .set({ locationRaw: "Remoto (Anywhere in the World)" })
        .where(inArray(s.publicJobs.id, poolIds));
    } finally {
      await owner.close();
    }
  });

  // Cada paso de la limpieza por separado: si uno falla, los demás igual corren
  test.afterAll(async () => {
    if (jobId) await deleteJob(jobId).catch(() => {});
    await deleteSeededPublicJobs(planTag).catch(() => {});
    if (originalRoles) await setSeedTargetRoles(originalRoles).catch(() => {});
    const { db, close } = ownerDb();
    try {
      const skillRows = await db
        .select({ id: s.skills.id })
        .from(s.skills)
        .where(inArray(s.skills.slug, Object.keys(LEVELS)))
        .catch(() => []);
      await db
        .delete(s.skillLevels)
        .where(
          and(
            eq(s.skillLevels.userId, E2E_USER_ID),
            inArray(
              s.skillLevels.skillId,
              skillRows.map((r) => r.id),
            ),
          ),
        )
        .catch(() => {});
      if (levelsBackup.length) {
        await db
          .insert(s.skillLevels)
          .values(levelsBackup)
          .catch(() => {});
      }
      await db
        .delete(s.learningPlanItems)
        .where(eq(s.learningPlanItems.userId, E2E_USER_ID))
        .catch(() => {});
      if (planBackup.length) {
        await db
          .insert(s.learningPlanItems)
          .values(planBackup)
          .catch(() => {});
      }
      // La cuenta nueva del onboarding
      const [user] = await db
        .select({ id: s.users.id })
        .from(s.users)
        .where(eq(s.users.email, email))
        .catch(() => []);
      if (user?.id) {
        const id = user.id;
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

  test("«Saltar al contenido»: el primer Tab llega al link y Enter lleva el foco a main", async ({
    page,
  }) => {
    await page.setViewportSize(WIDE);
    await login(page);
    // Pantalla recién cargada: el primer Tab parte del principio del documento
    await page.goto("/hoy");
    await expect(page.locator("main#contenido")).toBeAttached();
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Saltar al contenido" });
    await expect(skip, "el primer Tab llega al link de salto").toBeFocused();
    await expectFocusVisible(page, "Saltar al contenido");
    // Al recibir el foco el link se ve entero (no queda en el recorte de `sr-only`)
    const box = await skip.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThan(20);
    expect(box?.height ?? 0).toBeGreaterThan(10);

    await page.keyboard.press("Enter");
    await expect(page.locator("main#contenido")).toBeFocused();
    await expect(page).toHaveURL(/\/hoy#contenido$/);
    // El siguiente Tab sigue dentro del contenido, no vuelve al encabezado
    await page.keyboard.press("Tab");
    const insideMain = await page.evaluate(
      () => document.getElementById("contenido")?.contains(document.activeElement) ?? false,
    );
    expect(insideMain, "después del salto, Tab sigue en el contenido").toBe(true);
  });

  test("/jobs -> detalle -> 👍/👎 con Tab, Enter y Espacio", async ({ page }) => {
    await page.setViewportSize(WIDE);
    await login(page);
    await page.goto("/jobs");

    // La oferta propia (score 10) está arriba; se busca su link, que cubre toda la tarjeta
    const card = page.getByRole("link", { name: `Abrir el detalle de ${jobTitle}` });
    await reach(page, card, "tarjeta de la oferta");
    await page.keyboard.press("Enter");
    await page.waitForURL(new RegExp(`/jobs/${jobId}`));
    await expect(page.getByRole("group", { name: "¿Te sirve esta evaluación?" })).toBeVisible();

    const group = page.getByRole("group", { name: "¿Te sirve esta evaluación?" });
    const yes = group.getByRole("button", { name: "Sí, me sirve", exact: true });
    const no = group.getByRole("button", { name: "No, no me sirve", exact: true });

    // Enter en 👍
    await reach(page, yes, "botón 👍");
    await expect(yes).toHaveAttribute("aria-pressed", "false");
    await page.keyboard.press("Enter");
    await expect
      .poll(async () => (await evaluationFeedbackOf(jobId))?.humanVerdict)
      .toBe("de_acuerdo");
    await expect(yes).toHaveAttribute("aria-pressed", "true");

    // Espacio en 👎 (reemplaza al 👍)
    await reach(page, no, "botón 👎");
    await page.keyboard.press("Space");
    await expect
      .poll(async () => (await evaluationFeedbackOf(jobId))?.humanVerdict)
      .toBe("en_desacuerdo");
    await expect(no).toHaveAttribute("aria-pressed", "true");
    // Se vuelve a ver el foco con el botón apretado (el contraste del contorno cambia)
    await expect(no).toBeFocused();
    await expectFocusVisible(page, "botón 👎 apretado");
  });

  test("detalle de oferta: «Cargar mi nivel de X» abre el modal, se elige y se guarda solo con teclado (C-20)", async ({
    page,
  }) => {
    await page.setViewportSize(WIDE);
    // Preparación: una oferta sin evaluar con una skill de la taxonomía que la persona no tiene cargada
    const prepared = await (async () => {
      const { db, close } = ownerDb();
      try {
        const taxonomy = await db
          .select({ id: s.skills.id, slug: s.skills.slug, name: s.skills.name })
          .from(s.skills);
        const levels = await db
          .select({ skillId: s.skillLevels.skillId })
          .from(s.skillLevels)
          .where(eq(s.skillLevels.userId, E2E_USER_ID));
        const have = new Set(levels.map((l) => l.skillId));
        const free = taxonomy.find((t) => !have.has(t.id) && !t.slug.startsWith("english_"));
        if (!free) throw new Error("no hay una skill sin nivel para la prueba");
        const jobId = await createJob({
          title: `E2E teclado skill ${tag}`,
          status: "pendiente_jd",
          jdText: "Descripción ficticia del aviso de la prueba de teclado.",
        });
        await db.insert(s.jobSkills).values({ jobId, skillId: free.id, isMust: true });
        return { skillId: free.id, skillName: free.name, skillJobId: jobId };
      } finally {
        await close();
      }
    })();
    const { skillId, skillName, skillJobId } = prepared;
    try {
      await login(page);
      await page.goto(`/jobs/${skillJobId}`);
      const open = page.getByRole("button", { name: `Cargar mi nivel de ${skillName}` });
      await reach(page, open, "Cargar mi nivel de la skill");
      await page.keyboard.press("Enter");
      const dialog = page.getByRole("dialog", { name: `Tu nivel de ${skillName}` });
      await expect(dialog).toBeVisible();

      // El foco queda atrapado adentro: varias vueltas de Tab no llegan a la página de atrás. Al
      // pasar el último botón el navegador puede dejar el foco en su propia barra (`body`), nunca en
      // un elemento de la página, que queda inerte mientras el modal está abierto.
      for (let i = 0; i < 12; i += 1) {
        await page.keyboard.press("Tab");
        const inside = await dialog.evaluate((el) => {
          const active = el.ownerDocument.activeElement;
          return active === el.ownerDocument.body || el.contains(active);
        });
        expect(inside, "el foco no sale del modal a la página").toBe(true);
      }
      // Esc cierra y el foco vuelve al botón
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      await expect(open).toBeFocused();

      // Se abre de nuevo; flechas para elegir el nivel 2, Tab hasta Guardar y Enter
      await page.keyboard.press("Enter");
      await expect(dialog).toBeVisible();
      const level2 = dialog.getByRole("radio", { name: "lo usé en un proyecto" });
      await reach(page, dialog.getByRole("radio").first(), "primer nivel");
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("ArrowDown");
      await expect(level2).toBeChecked();
      await reach(page, dialog.getByRole("button", { name: "Guardar" }), "Guardar");
      await page.keyboard.press("Enter");
      await expect(dialog).toBeHidden();
      await expect(page.getByText("Sin nivel cargado (0)")).toBeVisible();
    } finally {
      const cleanup = ownerDb();
      try {
        if (skillJobId) await deleteJob(skillJobId).catch(() => {});
        await cleanup.db
          .delete(s.skillLevels)
          .where(and(eq(s.skillLevels.userId, E2E_USER_ID), eq(s.skillLevels.skillId, skillId)))
          .catch(() => {});
      } finally {
        await cleanup.close();
      }
    }
  });

  test("/plan: «Simular <skill>» y el selector de horas con Tab y Enter", async ({ page }) => {
    await setSeedTargetRoles({ targetRoles: [PLAN_CAREER], targetRole: PLAN_CAREER });
    await page.setViewportSize(WIDE);
    await login(page);
    await page.goto("/plan");

    // A 1280 px los botones están en la tabla; la versión de tarjetas está oculta
    const simulate = page.getByTestId("plan-sim-pick-power_bi");
    await reach(page, simulate, "Simular Power BI");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/[?&]simular=power_bi/);
    await expect(page.getByTestId("plan-sim-resultado")).toBeVisible();

    // Pantalla nueva (formulario GET): el foco arranca de cero
    const hours = page.getByTestId("plan-horas-10");
    await reach(page, hours, "horas por semana: 10 h");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/[?&]horas=10/);
    await expect(page).toHaveURL(/[?&]simular=power_bi/);
    await expect(page.getByTestId("plan-horas-10")).toHaveAttribute("aria-pressed", "true");
  });

  test("onboarding, paso 1, con una cuenta nueva y solo teclado", async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize(WIDE);

    // Preparación (no es lo que se mide): registro con la invitación propia
    await page.goto(`/register?code=${code}`);
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Contraseña", { exact: true }).fill(secret);
    await page.getByLabel("Repetí la contraseña").fill(secret);
    await page.getByLabel(/Leí y acepto/).check();
    await page.getByRole("button", { name: "Crear cuenta" }).click();
    await page.waitForURL("**/onboarding**");
    await expect(page.getByRole("heading", { name: "Completá tu perfil" })).toBeVisible();

    // Pantalla recién cargada: el primer Tab llega al link de salto
    await page.goto("/onboarding");
    await expect(page.getByRole("heading", { name: "Completá tu perfil" })).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Saltar al contenido" })).toBeFocused();
    await expectFocusVisible(page, "Saltar al contenido (onboarding)");

    // Carrera: casilla marcada con Espacio
    const career = page.locator(`input[name="targetRoles"][value="${ONBOARDING_CAREER}"]`);
    await reach(page, career, "carrera");
    await page.keyboard.press("Space");
    await expect(career).toBeChecked();

    // País: combobox, se escribe, se baja con flecha y se elige con Enter
    const country = page.getByLabel(/País de residencia/);
    await reach(page, country, "país de residencia");
    await page.keyboard.type("Brasil");
    const countries = page.getByRole("listbox", { name: "Países" });
    await expect(countries).toBeVisible();
    await page.keyboard.press("ArrowDown");
    // Dentro del listbox: el placeholder del select de inglés también es una opción `selected`
    await expect(countries.getByRole("option", { selected: true })).toContainText("Brasil");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("list", { name: "Países elegidos" })).toContainText("(BR)");

    // Select de CEFR: cerrado, elige por las letras que se escriben
    const english = page.getByLabel(/Tu nivel de inglés/);
    await reach(page, english, "nivel de inglés");
    await page.keyboard.type("C1");
    await expect(english).toHaveValue("C1");

    // Años de experiencia
    const years = page.getByLabel(/Años de experiencia/);
    await reach(page, years, "años de experiencia");
    await page.keyboard.type("4");
    await expect(years).toHaveValue("4");

    // Modalidad: «Remoto» viene marcada; con Espacio se desmarca y se vuelve a marcar
    const remote = page.getByRole("checkbox", { name: "Remoto", exact: true });
    await reach(page, remote, "modalidad Remoto");
    await page.keyboard.press("Space");
    await expect(remote).not.toBeChecked();
    await page.keyboard.press("Space");
    await expect(remote).toBeChecked();

    // Resumen: 80 caracteres o más
    const summary = page.getByLabel(/Resumen de tu perfil/);
    await reach(page, summary, "resumen del perfil");
    const text =
      "Perfil ficticio de la prueba de teclado: atención y éxito de clientes con cuatro años de experiencia.";
    expect(text.length).toBeGreaterThanOrEqual(80);
    await page.keyboard.insertText(text);
    await expect(summary).toHaveValue(text);

    // Guardar con Enter y pasar al paso 2
    const save = page.getByRole("button", { name: "Guardar y continuar" });
    await reach(page, save, "Guardar y continuar");
    await page.keyboard.press("Enter");
    await page.waitForURL("**/onboarding/skills**");
  });
});
