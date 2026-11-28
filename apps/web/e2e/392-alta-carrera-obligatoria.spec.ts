import * as s from "@job-search-os/db/schema";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { eq, sql } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";
// Import relativo directo (no el índice de @job-search-os/db, que arrastra import.meta)
import { deleteUserData } from "../../../packages/db/src/user-tables";
import { E2E_USER_ID, chooseRoles, ownerDb } from "./helpers";

/**
 * Flujo 392 (R32-01): en el alta la carrera es obligatoria. Sin un puesto y sin «Otra» el paso 1 no guarda y el
 * error queda junto a los puestos; con «Otra» (texto libre validado) guarda sin puestos; con puestos, el texto de
 * «Otra» se descarta. Lo cargado no se pierde ante un error. Todo inventado; las personas se borran al final.
 */
test.describe.configure({ mode: "serial" });

type Persona = {
  email: string;
  invitationId: string;
  context: BrowserContext;
  page: Page;
};

test.describe("Flujo 392: carrera obligatoria en el alta", () => {
  const tag = Date.now();
  const password = "onboarding-clave-local-392";
  const personas: Persona[] = [];

  async function crearPersona(browser: Browser, name: string): Promise<Persona> {
    const email = `${name}-${tag}@alta392.test`;
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
    const persona = { email, invitationId, context, page };
    personas.push(persona);
    await page.goto(`/register?code=${code}`);
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Nombre (opcional)").fill("Persona Alta");
    await page.getByLabel("Contraseña", { exact: true }).fill(password);
    await page.getByLabel("Repetí la contraseña").fill(password);
    await page.getByLabel(/Leí y acepto/).check();
    await page.getByRole("button", { name: "Crear cuenta" }).click();
    // En la base local el registro puede dejar en /hoy; el paso 1 se abre a mano (con el perfil incompleto el
    // layout lo manda a /onboarding igual)
    await page.waitForURL(/\/(onboarding|hoy)/);
    await page.goto("/onboarding");
    await page.waitForURL("**/onboarding**");
    return persona;
  }

  /** Todo el paso 1 menos los puestos y «Otra». */
  async function cargarResto(page: Page) {
    await page.getByLabel(/País de residencia/).fill("UY");
    await page.getByRole("option", { name: /\(UY\)/ }).click();
    await page.getByLabel(/Tu nivel de inglés/).selectOption("B2");
    await page.getByLabel(/Años de experiencia/).fill("4");
    await page.getByRole("checkbox", { name: "Remoto" }).check();
    await page
      .getByLabel(/Resumen de tu perfil/)
      .fill(
        "Perfil ficticio del flujo 392. Trabajo en proyectos de obra y documentación técnica, con experiencia en equipos chicos y clientes variados. Sin datos reales.",
      );
  }

  async function perfilDe(email: string) {
    const { db, close } = ownerDb();
    try {
      const [row] = await db
        .select({
          targetRoles: s.profiles.targetRoles,
          careerOther: s.profiles.careerOther,
        })
        .from(s.profiles)
        .innerJoin(s.users, eq(s.users.id, s.profiles.userId))
        .where(eq(s.users.email, email));
      return row ?? null;
    } finally {
      await close();
    }
  }

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
          await db.delete(s.jobs).where(eq(s.jobs.userId, user.id));
        }
        await db.delete(s.invitations).where(eq(s.invitations.id, p.invitationId));
      } finally {
        await close();
      }
    }
  });

  test("sin puesto y sin «Otra» no guarda: error junto a los puestos y nada se pierde", async ({
    browser,
  }) => {
    const { page } = await crearPersona(browser, "sincarrera");
    await cargarResto(page);
    await page.getByRole("button", { name: "Guardar y continuar" }).click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      "Elegí al menos un puesto o escribí tu carrera en «Otra»",
    );
    await expect(page).toHaveURL(/\/onboarding(\?|$)/);
    // Nada se perdió
    await expect(page.getByLabel(/Tu nivel de inglés/)).toHaveValue("B2");
    await expect(page.getByLabel(/Años de experiencia/)).toHaveValue("4");
  });

  test("«Otra» inválida da error en su campo; «Otra» válida guarda sin puestos", async ({
    browser,
  }) => {
    const persona = await crearPersona(browser, "otra");
    const { page } = persona;
    await cargarResto(page);
    const otra = page.getByTestId("carrera-otra").getByRole("textbox");
    await otra.fill("<i>Arquitectura</i>");
    await page.getByRole("button", { name: "Guardar y continuar" }).click();
    await expect(page.getByRole("main").getByRole("alert").first()).toContainText(
      "Escribí tu carrera",
    );
    await expect(otra).toHaveAttribute("aria-invalid", "true");
    await expect(otra).toHaveValue("<i>Arquitectura</i>");
    expect(await perfilDe(persona.email)).toMatchObject({ targetRoles: [] });

    await otra.fill("Arquitectura");
    await page.getByRole("button", { name: "Guardar y continuar" }).click();
    await page.waitForURL("**/onboarding/skills**");
    expect(await perfilDe(persona.email)).toEqual({
      targetRoles: [],
      careerOther: "Arquitectura",
    });
  });

  test("con un puesto elegido, el texto de «Otra» se descarta", async ({ browser }) => {
    const persona = await crearPersona(browser, "puesto");
    const { page } = persona;
    await chooseRoles(page, ["abogacia"]);
    await cargarResto(page);
    await page.getByTestId("carrera-otra").getByRole("textbox").fill("Arquitectura");
    await page.getByRole("button", { name: "Guardar y continuar" }).click();
    await page.waitForURL("**/onboarding/skills**");
    expect(await perfilDe(persona.email)).toEqual({
      targetRoles: ["abogacia"],
      careerOther: null,
    });
  });
});
