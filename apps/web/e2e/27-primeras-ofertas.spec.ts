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
  closePrivacyDialog,
  deleteSeededPublicJobs,
  login,
  ownerDb,
  runDemoWorker,
  seedPublicJobs,
} from "./helpers";

/**
 * Flujo 27 (ronda 39): onboarding sin email. Una persona nueva (invitación sembrada) elige el
 * puesto QA, saltea las skills y ve «Tus primeras ofertas» del pool público (sembrado: el pool no
 * se descarga en e2e), con la atribución a la fuente y sin las ofertas de otro puesto. Después
 * se evalúan, conecta el email como paso opcional (con el recuadro de confianza) y llega a /jobs,
 * donde el aviso de email se descarta y no vuelve. Todo inventado; la persona y las filas del
 * pool se borran al final. No depende de «Evaluando…»: espera el final.
 */
test.describe.configure({ mode: "serial" });

test.describe("Flujo 27: primeras ofertas del pool, del puesto a /jobs", () => {
  const tag = Date.now();
  const email = `ofertas-${tag}@ofertas.test`;
  const password = "ofertas-clave-local-27";
  const qaTitles = [
    `Oferta Ficticia QA Uno ${tag}`,
    `Oferta Ficticia QA Dos ${tag}`,
    `Oferta Ficticia QA Tres ${tag}`,
  ];
  const uxTitle = `Oferta Ficticia UX Diseño ${tag}`;

  let code: string;
  let invitationId: string | undefined;
  let userId: string | null = null;
  let context: BrowserContext;
  let page: Page;

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
    await seedPublicJobs(tag, [
      {
        title: qaTitles[0]!,
        company: "Empresa Ficticia 1",
        sourceKind: "getonboard_api",
        roleHints: ["qa"],
      },
      {
        title: qaTitles[1]!,
        company: "Empresa Ficticia 2",
        sourceKind: "remoteok",
        roleHints: ["qa"],
      },
      {
        title: qaTitles[2]!,
        company: "Empresa Ficticia 3",
        sourceKind: "jobicy",
        roleHints: ["qa", "backend"],
      },
      {
        title: uxTitle,
        company: "Empresa Ficticia 4",
        sourceKind: "getonboard_api",
        roleHints: ["ux_ui"],
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
    } finally {
      await close();
    }
  });

  test("elige el puesto QA en el paso 1, saltea skills y llega a «Tus primeras ofertas»", async () => {
    await page.goto(`/register?code=${code}`);
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Nombre (opcional)").fill("Persona Ofertas");
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

    // El puesto es obligatorio y viene sin nada marcado
    const roles = page.locator('input[name="targetRoles"]');
    await expect(roles.first()).not.toBeChecked();
    await expect(page.locator('input[name="targetRoles"]:checked')).toHaveCount(0);
    await chooseRoles(page, ["qa"]);
    await page.getByLabel(/País de residencia/).fill("BR");
    await page.getByRole("option", { name: /\(BR\)/ }).click();
    await page.getByLabel(/Tu nivel de inglés/).selectOption("C1");
    await page.getByLabel(/Años de experiencia/).fill("6");
    await page
      .getByLabel(/Resumen de tu perfil/)
      .fill(
        "Perfil ficticio de la prueba de primeras ofertas: testing manual y automatizado con seis años de experiencia, sin experiencia en móvil.",
      );
    await page.getByRole("checkbox", { name: "Remoto" }).check();
    await page.getByRole("button", { name: "Guardar y continuar" }).click();

    // El rol del paso 1 ya viene elegido en Mis skills
    await page.waitForURL("**/onboarding/skills**");
    await expect(page.getByRole("link", { name: "QA", exact: true })).toHaveAttribute(
      "aria-current",
      "true",
    );
    // «Saltear por ahora» es un botón del formulario: no guarda niveles y sigue a las ofertas
    await page.getByRole("button", { name: "Saltear por ahora" }).click();
    await page.waitForURL("**/onboarding/ofertas**");
    await expect(page.getByRole("heading", { name: "Tus primeras ofertas" })).toBeVisible();

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
      expect(user!.targetRoles).toEqual(["qa"]);
      expect(user!.targetRole).toBe("qa");
    } finally {
      await close();
    }
  });

  test("muestra las ofertas del pool para QA con su fuente, y no las de UX", async () => {
    expect(userId, "el test anterior crea a la persona").not.toBeNull();
    // Con o sin la asignación real: la ayuda no repite lo que ya esté asignado
    await assignSeededPoolJobs(userId!, tag);
    await page.goto("/onboarding/ofertas");

    for (const title of qaTitles) await expect(page.getByText(title)).toBeVisible();
    expect(await page.content()).not.toContain(uxTitle);

    const offer = (title: string) => page.getByTestId("first-offer").filter({ hasText: title });
    await expect(offer(qaTitles[0]!)).toContainText("Publicado en Get on Board");
    await expect(offer(qaTitles[1]!)).toContainText("Publicado en Remote OK");
    await expect(offer(qaTitles[2]!)).toContainText("Publicado en Jobicy");

    const original = offer(qaTitles[0]!).getByRole("link", { name: /Ver el aviso original/ });
    await expect(original).toHaveAttribute("href", /^https:\/\/example\.com\/e2e-pool\//);
    await expect(original).toHaveAttribute("target", "_blank");
    await expect(original).toHaveAttribute("rel", /noopener/);
    expect(await original.getAttribute("rel")).not.toMatch(/nofollow/);

    await expect(page.getByText(/Las ordenamos por lo que nos contaste/)).toBeVisible();
    // Ronda 49: el recuadro de privacidad salió de «Tus primeras ofertas» (ahora es un modal del asistente)
    await expect(page.getByTestId("trust-box")).toHaveCount(0);
  });

  test("después de evaluar aparece un score", async () => {
    runDemoWorker();
    await expect(async () => {
      await page.goto("/onboarding/ofertas");
      await expect(page.getByTestId("first-offer-score").first()).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 30_000, intervals: [2_000] });
  });

  test("conectar el email es opcional y el asistente trae el recuadro de confianza en un modal", async () => {
    await page.goto("/onboarding/ofertas");
    // Ronda 49: el acceso está en el aviso de arriba
    await page.getByRole("link", { name: "Conectar mis alertas" }).click();
    await page.waitForURL("**/onboarding/asistente**");
    await expect(page.getByRole("heading", { name: /Conectá tus alertas de email/ })).toBeVisible();

    // Se abre solo al entrar, con el mismo texto de siempre
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const trust = dialog.getByTestId("trust-box");
    await expect(trust).toBeVisible();
    for (const text of ["Qué leemos", "Qué no leemos", "Cómo cortarlo", "Quién está detrás"]) {
      await expect(trust).toContainText(text);
    }
    await expect(trust).toContainText("No tenemos acceso a tu cuenta de Gmail");
    // El responsable se completa en la web: nunca queda el marcador a la vista
    await expect(trust).not.toContainText("{responsable}");
    await expect(trust.getByRole("link", { name: /política de privacidad/i })).toHaveAttribute(
      "href",
      "/legal/privacidad",
    );

    await closePrivacyDialog(page);

    // La pantalla de reenvío de Gmail no carga por URL: son instrucciones en texto, sin link
    const current = page.locator('[aria-current="step"]');
    await expect(current).toContainText("Reenvío y correo POP/IMAP");
    await expect(current.locator('a[href*="mail.google.com"]')).toHaveCount(0);
  });

  test("«Ir a mis ofertas» lleva a /jobs, donde el aviso de email se descarta y no vuelve", async () => {
    await page.getByRole("link", { name: "Volver a Tus primeras ofertas" }).click();
    await page.waitForURL("**/onboarding/ofertas**");
    // Ronda 49: hay dos «Ir a mis ofertas» (arriba y al final de la lista)
    await page.getByRole("link", { name: "Ir a mis ofertas" }).first().click();
    await page.waitForURL("**/jobs**");

    // D2: mientras la checklist «Primeros pasos» está visible, el aviso de email no se muestra
    // (el ítem de alertas lo reemplaza). Se oculta la checklist para probar el aviso
    await expect(page.getByTestId("email-nudge")).toHaveCount(0);
    await page.getByTestId("first-steps").getByRole("button", { name: "Ocultar" }).click();
    await expect(page.getByTestId("first-steps")).toHaveCount(0);

    const nudge = page.getByTestId("email-nudge");
    await expect(nudge).toContainText("¿Recibís alertas de empleo por email?");
    await expect(nudge.getByRole("link", { name: "Sumalas en 3 pasos" })).toBeVisible();

    await nudge.getByRole("button", { name: "No, gracias" }).click();
    await expect(page.getByTestId("email-nudge")).toHaveCount(0);

    await page.reload();
    await expect(page.getByRole("heading", { name: "Ofertas", exact: true })).toBeVisible();
    await expect(page.getByTestId("email-nudge")).toHaveCount(0);
  });

  test("en Ajustes, «Tus puestos» cambia de QA a UX/UI y avisa que las ofertas se actualizan", async () => {
    await page.goto("/settings#puesto");
    const section = page.locator("#puesto");
    await expect(section.getByTestId("current-roles")).toContainText("Tus puestos actuales: QA");
    const qa = section.locator('input[name="targetRoles"][value="qa"]');
    await expect(qa).toBeChecked();

    await qa.uncheck();
    await chooseRoles(section, ["ux_ui"]);
    await section.getByRole("button", { name: "Guardar puestos" }).click();
    await page.waitForURL("**/settings?puesto=guardado**");
    await expect(page.locator("#puesto").getByRole("status")).toContainText(
      "Guardado. Tus ofertas se actualizan con tus puestos.",
    );
    await expect(page.locator('#puesto input[name="targetRoles"][value="ux_ui"]')).toBeChecked();

    const { db, close } = ownerDb();
    try {
      const [row] = await db
        .select({ targetRole: s.profiles.targetRole, targetRoles: s.profiles.targetRoles })
        .from(s.profiles)
        .where(eq(s.profiles.userId, userId!));
      expect(row!.targetRoles).toEqual(["ux_ui"]);
      expect(row!.targetRole).toBe("ux_ui");
    } finally {
      await close();
    }
  });
});

test.describe("Flujo 27b: aviso «Elegí tu puesto» en /jobs", () => {
  test("una cuenta sin puesto ve el aviso, lo descarta y no vuelve", async ({ page }) => {
    // El usuario e2e principal no tiene puestos elegidos (target_roles vacío)
    const { db, close } = ownerDb();
    try {
      const [row] = await db
        .select({ targetRoles: s.profiles.targetRoles })
        .from(s.profiles)
        .where(eq(s.profiles.userId, E2E_USER_ID));
      expect(row?.targetRoles ?? []).toEqual([]);
    } finally {
      await close();
    }

    await login(page);
    await page.goto("/jobs");
    const nudge = page.getByTestId("role-nudge");
    await expect(nudge).toContainText("Elegí tu puesto para recibir ofertas que te sirvan.");
    await expect(nudge.getByRole("link", { name: "Elegir mi puesto" })).toHaveAttribute(
      "href",
      "/settings#puesto",
    );

    await nudge.getByRole("button", { name: "Ahora no" }).click();
    await expect(page.getByTestId("role-nudge")).toHaveCount(0);

    await page.reload();
    await expect(page.getByRole("heading", { name: "Ofertas", exact: true })).toBeVisible();
    await expect(page.getByTestId("role-nudge")).toHaveCount(0);
  });
});
