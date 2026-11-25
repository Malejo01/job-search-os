import { expect, test, type Page } from "@playwright/test";
import { ensureSecondUser, loginAsSecondUser, removeSecondUser } from "./helpers";

/**
 * Ayudas de los flujos 251 a 255 (R27): Afi en el asistente. Persona B (ficticia, tester del asistente).
 * El nombre del botón sale del texto de la pantalla: «Preguntale a Afi».
 */
export const AFI_BOTON = "Preguntale a Afi";

export const afiBoton = (page: Page) => page.getByRole("button", { name: AFI_BOTON, exact: true });

export function afiSetup(): void {
  test.beforeAll(ensureSecondUser);
  test.afterAll(removeSecondUser);
}

/** Entra como la persona B y devuelve el botón; si el asistente no está encendido, saltea (en el CI es error). */
export async function entrarYBuscarBoton(page: Page) {
  await loginAsSecondUser(page);
  const boton = afiBoton(page);
  if ((await boton.count()) === 0) {
    expect(process.env.CI, "En el CI el botón del asistente tiene que estar").toBeFalsy();
    test.skip(true, "El asistente no está encendido para la persona B (ASSISTANT_ENABLED)");
  }
  return boton;
}

export async function abrirPanel(page: Page) {
  const boton = await entrarYBuscarBoton(page);
  await boton.click();
  const panel = page.getByTestId("assistant-panel");
  await expect(panel).toBeVisible();
  return { boton, panel };
}
