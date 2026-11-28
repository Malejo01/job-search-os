import * as s from "@job-search-os/db/schema";
import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
// Import relativo directo (el índice del paquete arrastra import.meta, que Playwright no transpila)
import { signNewsUnsubscribe } from "../../../packages/adapters/src/news/unsubscribe-token";
import {
  borrarPersonaAlta,
  crearPersonaAlta,
  entrarComo,
  perfilDe,
  type PersonaAlta,
} from "./alta-helpers";
import { E2E_B_EMAIL, E2E_B_PASSWORD, E2E_B_USER_ID, ensureSecondUser, ownerDb } from "./helpers";

/**
 * Flujos 397 (R32-09): la baja del email de novedades. En un clic y sin iniciar sesión, con un enlace firmado que
 * falla cerrado; idempotente; el POST de «baja en un clic» del cliente de correo anda igual; y la preferencia se
 * cambia en Ajustes. Nada se manda: el envío se prueba con el adaptador simulado en `packages/adapters`. Personas
 * inventadas.
 *
 * Necesita que el servidor de e2e y este runner compartan la clave de la baja: `NEWS_EMAIL_SECRET` (o `AUTH_SECRET`).
 * Sin ella el spec se saltea. La parte de Ajustes necesita además `NEWS_EMAIL=testers` en el servidor (la persona
 * B es tester) y `E2E_NEWS_EMAIL_MODE=testers` en el runner.
 */
const SECRET = process.env.NEWS_EMAIL_SECRET ?? process.env.AUTH_SECRET ?? "";
const tag = Date.now();
const clave = "clave-e2e-novedades-local";
const A: PersonaAlta = {
  id: "c0000000-0000-4000-8000-000000000399",
  email: `novedades-a-${tag}@ejemplo.test`,
  password: clave,
  name: "Persona Novedades Uno",
};
const B: PersonaAlta = {
  id: "c0000000-0000-4000-8000-00000000039a",
  email: `novedades-b-${tag}@ejemplo.test`,
  password: clave,
  name: "Persona Novedades Dos",
};

test.describe.configure({ mode: "serial" });
test.use({ viewport: { width: 390, height: 844 } });

async function pref(id: string): Promise<boolean | undefined> {
  return (await perfilDe(id))?.newsEmail;
}

test.describe("Flujo 397: baja del email de novedades", () => {
  test.skip(SECRET.length < 16, "sin NEWS_EMAIL_SECRET o AUTH_SECRET compartido con el servidor");

  test.beforeAll(async () => {
    await crearPersonaAlta(A, { targetRoles: ["abogacia"], careerAskedAt: new Date() });
    await crearPersonaAlta(B, { targetRoles: ["abogacia"], careerAskedAt: new Date() });
  });
  test.afterAll(async () => {
    for (const p of [A, B]) await borrarPersonaAlta(p.id).catch(() => {});
  });

  test("el enlace firmado da de baja sin sesión, y repetirlo no cambia nada", async ({
    page,
    context,
  }) => {
    expect(await pref(A.id)).toBe(true);
    const token = signNewsUnsubscribe(A.id, SECRET);
    // Sin cookies: la baja no pide iniciar sesión
    await context.clearCookies();
    await page.goto(`/novedades/baja?t=${encodeURIComponent(token)}`);
    await expect(page).toHaveURL(/\/novedades\/baja\/listo\?r=ok/);
    await expect(page.getByTestId("novedades-baja-titulo")).toHaveText("Te diste de baja");
    await expect(page.getByTestId("novedades-baja-texto")).toContainText(
      "lo podés volver a prender",
    );
    expect(await pref(A.id)).toBe(false);
    // A la persona B no le pasó nada
    expect(await pref(B.id)).toBe(true);

    // Idempotente
    await page.goto(`/novedades/baja?t=${encodeURIComponent(token)}`);
    await expect(page.getByTestId("novedades-baja-titulo")).toHaveText("Te diste de baja");
    expect(await pref(A.id)).toBe(false);
  });

  test("un enlace alterado, de otra persona o vacío falla cerrado: nadie cambia", async ({
    page,
    request,
  }) => {
    const tokenA = signNewsUnsubscribe(A.id, SECRET);
    const sig = tokenA.split(".")[1]!;
    const bad = [
      `${B.id}.${sig}`, // el id de B con la firma de A
      tokenA.slice(0, -3) + "xyz",
      "no-es-un-token",
      "",
    ];
    for (const t of bad) {
      await page.goto(`/novedades/baja?t=${encodeURIComponent(t)}`);
      await expect(page).toHaveURL(/\/novedades\/baja\/listo\?r=invalido/);
      await expect(page.getByTestId("novedades-baja-titulo")).toHaveText("El enlace no es válido");
      // Dice dónde cambiarlo y no revela por qué falló
      await expect(page.getByRole("link", { name: "Ir a Ajustes" })).toBeVisible();
    }
    // Sin parámetro
    const noParam = await request.get("/novedades/baja", { maxRedirects: 0 });
    expect(noParam.status()).toBe(303);
    expect(await pref(B.id)).toBe(true);

    // La pantalla de confirmación sola no hace nada y no se indexa
    await page.goto("/novedades/baja/listo?r=ok");
    expect(await pref(B.id)).toBe(true);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  });

  test("la baja en un clic del cliente de correo (POST) funciona y devuelve 200", async ({
    request,
  }) => {
    expect(await pref(B.id)).toBe(true);
    const token = signNewsUnsubscribe(B.id, SECRET);
    const ok = await request.post(`/novedades/baja?t=${encodeURIComponent(token)}`, {
      form: { "List-Unsubscribe": "One-Click" },
    });
    expect(ok.status()).toBe(200);
    expect(await pref(B.id)).toBe(false);
    const bad = await request.post(`/novedades/baja?t=basura`);
    expect(bad.status()).toBe(400);
  });

  test("a 360 px la confirmación se lee sin desborde y el botón mide 44 px", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto("/novedades/baja/listo?r=ok");
    const link = page.getByRole("link", { name: "Ir a Ajustes" });
    const box = await link.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);
  });
});

test.describe("Flujo 397b: la preferencia en Ajustes", () => {
  test.skip(
    process.env.E2E_NEWS_EMAIL_MODE !== "testers",
    "el servidor de e2e no corre con NEWS_EMAIL=testers",
  );
  const T: PersonaAlta = {
    id: E2E_B_USER_ID,
    email: E2E_B_EMAIL,
    password: E2E_B_PASSWORD,
    name: "Persona B",
  };

  test("la persona tester ve la sección, la apaga y la vuelve a prender", async ({ page }) => {
    // Persona B de los e2e (tester)
    await ensureSecondUser();
    const { db, close } = ownerDb();
    try {
      await db
        .update(s.profiles)
        .set({ newsEmail: true })
        .where(eq(s.profiles.userId, E2E_B_USER_ID));
    } finally {
      await close();
    }
    await entrarComo(page, T);
    await page.goto("/settings");
    const seccion = page.getByTestId("novedades-email");
    await expect(seccion).toBeVisible();
    const casilla = seccion.getByRole("checkbox", { name: "Quiero recibir el email de novedades" });
    await expect(casilla).toBeChecked();
    await casilla.uncheck();
    await seccion.getByRole("button", { name: "Guardar" }).click();
    await expect(page.getByTestId("novedades-ok")).toBeVisible();
    await expect(casilla).not.toBeChecked();
    expect(await pref(E2E_B_USER_ID)).toBe(false);
    await casilla.check();
    await seccion.getByRole("button", { name: "Guardar" }).click();
    // El aviso de «guardado» ya estaba en pantalla por el guardado anterior: se espera el cambio en la base
    await expect.poll(() => pref(E2E_B_USER_ID)).toBe(true);
    await expect(casilla).toBeChecked();
  });
});
