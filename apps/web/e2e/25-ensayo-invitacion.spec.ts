import * as s from "@job-search-os/db/schema";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { and, eq, sql } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";
// Import relativo directo (no el índice de @job-search-os/db, que arrastra import.meta)
import { deleteUserData } from "../../../packages/db/src/user-tables";
import { E2E_USER_ID, createJob, deleteJob, login, ownerDb } from "./helpers";

/**
 * Flujo 25 (ronda 27): el guion de `ops/ensayo-invitacion.md` de punta a punta. Una persona nueva
 * (B) se registra con una invitación, hace el onboarding, llega al asistente y ve su primera
 * alerta; ni ella ni A ven nada del otro. La invitación se siembra con la conexión del dueño porque
 * el server de e2e no define ADMIN_EMAILS (crearla por la UI de Ajustes queda para el ensayo real).
 * Todo inventado; B se borra al final con deleteUserData.
 */
test.describe.configure({ mode: "serial" });

test.describe("Flujo 25: ensayo de invitación, de la invitación a la primera oferta", () => {
  const tag = Date.now();
  const emailB = `ensayo-${tag}@ensayo.test`;
  const passwordB = "ensayo-clave-local-25";
  const titleB = `Oferta Ficticia Ensayo B ${tag}`;
  const titleA = `Oferta Ficticia Ensayo A ${tag}`;

  let code: string;
  let invitationId: string | undefined;
  let userIdB: string | null = null;
  let jobB: string;
  let jobA: string | undefined;
  let contextB: BrowserContext;
  let pageB: Page;

  test.beforeAll(async ({ browser }) => {
    // Igual que createInvitation (lib/invitations.ts): código aleatorio, en la base solo su sha256
    code = randomBytes(32).toString("base64url");
    const codeHash = createHash("sha256").update(code).digest("hex");
    const { db, close } = ownerDb();
    try {
      const [row] = await db
        .insert(s.invitations)
        .values({ codeHash, email: emailB, createdByUserId: E2E_USER_ID })
        .returning({ id: s.invitations.id });
      invitationId = row!.id;
    } finally {
      await close();
    }
    jobA = await createJob({
      title: titleA,
      status: "prefiltrada",
      jdText: "JD ficticia de A para el ensayo de invitación.",
    });
    contextB = await browser.newContext({ viewport: { width: 390, height: 844 } });
    pageB = await contextB.newPage();
  });

  // Cada paso de la limpieza por separado: si uno falla, los demás igual corren
  test.afterAll(async () => {
    await contextB?.close().catch(() => {});
    if (jobA) await deleteJob(jobA).catch(() => {});
    const { db, close } = ownerDb();
    try {
      const [user] = await db
        .select({ id: s.users.id })
        .from(s.users)
        .where(eq(s.users.email, emailB));
      const id = user?.id ?? userIdB;
      if (id) {
        await db
          .transaction(async (tx) => {
            await tx.execute(sql`select set_config('app.user_id', ${id}, true)`);
            await deleteUserData(tx as never, id);
          })
          .catch(() => {});
        // La primera ingesta corre en `after()` y puede insertar algo después del borrado
        await db.delete(s.jobs).where(eq(s.jobs.userId, id));
      }
      if (invitationId) await db.delete(s.invitations).where(eq(s.invitations.id, invitationId));
    } finally {
      await close();
    }
  });

  test("B se registra con el link, entra y completa el onboarding hasta el asistente", async () => {
    await pageB.goto(`/register?code=${code}`);
    await expect(pageB.getByText("Creá tu cuenta con tu invitación")).toBeVisible();

    // Los términos y la política se despliegan sin marcadores entre corchetes
    await pageB
      .locator("details")
      .evaluateAll((els) => els.forEach((d) => ((d as HTMLDetailsElement).open = true)));
    const texto = await pageB.locator("main").innerText();
    for (const marcador of ["[RESPONSABLE]", "[DOMICILIO]", "[EMAIL DE CONTACTO]"]) {
      expect(texto).not.toContain(marcador);
    }

    await pageB.getByLabel("Email").fill(emailB);
    await pageB.getByLabel("Nombre (opcional)").fill("Persona Ensayo");
    await pageB.getByLabel("Contraseña", { exact: true }).fill(passwordB);
    await pageB.getByLabel("Repetí la contraseña").fill(passwordB);
    await pageB.getByLabel(/Leí y acepto/).check();
    await pageB.getByRole("button", { name: "Crear cuenta" }).click();
    await expect(pageB.getByRole("heading", { name: "Cuenta creada" })).toBeVisible();

    await pageB.getByRole("link", { name: "Ir a entrar" }).click();
    await pageB.getByLabel("Email").fill(emailB);
    await pageB.getByLabel("Contraseña").fill(passwordB);
    await pageB.getByRole("button", { name: "Entrar" }).click();
    await pageB.waitForURL("**/onboarding**");
    await expect(pageB.getByRole("heading", { name: "Completá tu perfil" })).toBeVisible();

    // Un perfil distinto del de A: otro país y pocos años
    await pageB.getByLabel(/País de residencia/).selectOption("BR");
    await pageB.getByLabel(/Inglés \(nivel CEFR\)/).selectOption("B2");
    await pageB.getByLabel(/Años de experiencia/).fill("2");
    await pageB
      .getByLabel(/Resumen de tu perfil/)
      .fill(
        "Perfil ficticio del ensayo: desarrollo backend con dos años de experiencia, Python y PostgreSQL en producción, sin experiencia en móvil.",
      );
    await pageB.getByRole("button", { name: "Guardar y continuar" }).click();
    // Paso opcional de skills (ronda 28): se saltea
    await pageB.waitForURL("**/onboarding/skills**");
    await pageB.getByRole("link", { name: "Saltear por ahora" }).click();
    await pageB.waitForURL("**/onboarding/asistente**");

    await expect(pageB.getByTestId("assistant-address")).toHaveText(/^u_[^@]{20}@/);
    await expect(pageB.getByText(/formato anterior/)).toHaveCount(0);

    const { db, close } = ownerDb();
    try {
      const [user] = await db
        .select({ id: s.users.id })
        .from(s.users)
        .where(eq(s.users.email, emailB));
      userIdB = user!.id;
      const [inv] = await db
        .select({ usedAt: s.invitations.usedAt })
        .from(s.invitations)
        .where(eq(s.invitations.id, invitationId!));
      expect(inv?.usedAt).not.toBeNull();
    } finally {
      await close();
    }
  });

  test("primera alerta sembrada: B ve su oferta en /jobs", async () => {
    expect(userIdB, "el test anterior crea a B").not.toBeNull();
    const { db, close } = ownerDb();
    try {
      const body = JSON.stringify({
        event: { data: { subject: `Alerta ficticia de B ${tag}` } },
        content: { text: "Cuerpo ficticio de la alerta", html: null },
      });
      const [blob] = await db
        .insert(s.rawBlobs)
        .values({
          userId: userIdB!,
          kind: "inbound_email",
          contentType: "application/json",
          body,
          bytes: body.length,
        })
        .returning({ id: s.rawBlobs.id });
      const rawRef = `pg:${blob!.id}`;
      await db.insert(s.inboundEmails).values({
        userId: userIdB!,
        fromAddress: "Alertas <alertas@mail.empresa-b-ensayo.example>",
        subject: `Alerta ficticia de B ${tag}`,
        rawRef,
        parser: "ensayo",
        jobsExtracted: 1,
        error: null,
        receivedAt: new Date(),
        seenAt: new Date(),
      });
      const [job] = await db
        .insert(s.jobs)
        .values({
          userId: userIdB!,
          companyRaw: `Empresa B ${tag}`,
          title: titleB,
          titleNormalized: titleB.toLowerCase(),
          canonicalUrl: `https://example.com/ensayo-b/${tag}`,
          locationRaw: "Remoto (Brasil)",
          modality: "remoto",
          status: "evaluada",
          jdText: `Descripción ficticia de la oferta de B ${tag}.`,
          flags: [],
          firstSeenAt: new Date(),
        })
        .returning({ id: s.jobs.id });
      jobB = job!.id;
      await db.insert(s.jobSources).values({
        jobId: jobB,
        kind: "email_linkedin",
        sourceName: "ensayo",
        url: `https://example.com/ensayo-b/${tag}`,
        rawRef,
        seenAt: new Date(),
      });
      await db.insert(s.evaluations).values({
        jobId: jobB,
        userId: userIdB!,
        criteriaVersion: 1,
        promptVersion: "evaluate_job@e2e",
        model: "fake",
        hadFullJd: true,
        score: 8,
        locationOk: "ok",
        modality: "remoto",
        discipline: "ai_engineer",
        matchFuerte: [],
        gaps: [],
        bloqueadoresDuros: [],
        senalesPositivas: [],
        veredicto: `Evaluación ficticia del ensayo ${tag}.`,
        accion: "aplicar",
      });
      // Confirma que quedó en la base antes de mirar la pantalla
      const [check] = await db
        .select({ id: s.jobs.id })
        .from(s.jobs)
        .where(and(eq(s.jobs.id, jobB), eq(s.jobs.userId, userIdB!)));
      expect(check).toBeDefined();
    } finally {
      await close();
    }
    await pageB.goto("/jobs");
    await expect(pageB.getByText(titleB)).toBeVisible();
    expect(await pageB.content()).not.toContain(titleA);
  });

  test("B no ve lo de A, ni por lista ni por URL", async () => {
    for (const path of [
      "/jobs",
      "/jobs/pending-jd",
      "/inbox",
      "/applications",
      "/market",
      "/plan",
    ]) {
      await pageB.goto(path);
      expect(await pageB.content(), `${path} muestra algo de A`).not.toContain(titleA);
    }
    const response = await pageB.goto(`/jobs/${jobA}`);
    const text = await pageB.locator("body").innerText();
    expect(response?.status() === 404 || /404|no se encontr|could not be found/i.test(text)).toBe(
      true,
    );
    expect(await pageB.content()).not.toContain(titleA);
  });

  test("A no ve la oferta de B, ni por lista ni por URL", async ({ page }) => {
    await login(page);
    for (const path of [
      "/jobs",
      "/jobs/pending-jd",
      "/inbox",
      "/applications",
      "/market",
      "/plan",
    ]) {
      await page.goto(path);
      expect(await page.content(), `${path} muestra algo de B`).not.toContain(titleB);
    }
    const response = await page.goto(`/jobs/${jobB}`);
    const text = await page.locator("body").innerText();
    expect(response?.status() === 404 || /404|no se encontr|could not be found/i.test(text)).toBe(
      true,
    );
    expect(await page.content()).not.toContain(titleB);
    // Control: A sí ve lo suyo (el spec mide algo)
    await page.goto(`/jobs/${jobA}`);
    await expect(page.getByRole("heading", { name: titleA })).toBeVisible();
  });
});
