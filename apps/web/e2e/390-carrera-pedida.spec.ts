import { expect, test } from "@playwright/test";
import {
  borrarPersonaAlta,
  crearPersonaAlta,
  entrarComo,
  perfilDe,
  type PersonaAlta,
} from "./alta-helpers";

/**
 * Flujos 390 y 391 (R32-01): una cuenta que nunca cargó su carrera la ve pedida una sola vez, sin perder la pantalla
 * en la que estaba. Se guarda con una de las ocho de la beta o con «Otra» (texto libre validado); «Ahora no» tampoco
 * vuelve. Una cuenta que ya la tiene no ve nada. Personas inventadas.
 */
test.describe.configure({ mode: "serial" });

const tag = Date.now();
const clave = "clave-e2e-alta-390-local";
const A: PersonaAlta = {
  id: "c0000000-0000-4000-8000-000000000390",
  email: `alta-390-${tag}@ejemplo.test`,
  password: clave,
  name: "Persona Alta Uno",
};
const B: PersonaAlta = {
  id: "c0000000-0000-4000-8000-000000000391",
  email: `alta-391-${tag}@ejemplo.test`,
  password: clave,
  name: "Persona Alta Dos",
};
const C: PersonaAlta = {
  id: "c0000000-0000-4000-8000-000000000392",
  email: `alta-392-${tag}@ejemplo.test`,
  password: clave,
  name: "Persona Alta Tres",
};
const D: PersonaAlta = {
  id: "c0000000-0000-4000-8000-000000000393",
  email: `alta-393-${tag}@ejemplo.test`,
  password: clave,
  name: "Persona Alta Cuatro",
};

test.use({ viewport: { width: 390, height: 844 } });

test.afterAll(async () => {
  for (const p of [A, B, C, D]) await borrarPersonaAlta(p.id).catch(() => {});
});

test.describe("Flujo 390: carrera pedida a una cuenta que no la cargó", () => {
  test.beforeAll(async () => {
    await crearPersonaAlta(A);
  });

  test("se pide arriba de lo que estaba mirando, se guarda con una carrera de la beta y no vuelve", async ({
    page,
  }) => {
    await entrarComo(page, A);
    await page.goto("/jobs");
    const recuadro = page.getByTestId("carrera-pedida");
    await expect(recuadro).toBeVisible();
    await expect(recuadro.getByRole("heading", { name: "¿Cuál es tu carrera?" })).toBeVisible();
    // Las ocho de la beta y «Otra»
    await expect(recuadro.getByRole("radio")).toHaveCount(9);
    // Sigue en la misma pantalla, con su contenido
    await expect(page).toHaveURL(/\/jobs(\?|$)/);
    await expect(page.getByRole("main")).toBeVisible();

    // Sin elegir nada, el servidor lo rechaza con un mensaje junto al grupo
    await recuadro.getByRole("button", { name: "Guardar mi carrera" }).click();
    await expect(recuadro.getByRole("alert")).toContainText("Elegí una carrera");

    await recuadro.getByRole("radio", { name: "Abogacía" }).check();
    await recuadro.getByRole("button", { name: "Guardar mi carrera" }).click();
    // Al guardar, el servidor revalida el layout y el recuadro desaparece (ya no hace falta pedirla)
    await expect(page.getByTestId("carrera-pedida")).toHaveCount(0);
    await expect(page).toHaveURL(/\/jobs(\?|$)/);
    await expect.poll(async () => (await perfilDe(A.id))?.careerAskedAt ?? null).not.toBeNull();

    const perfil = await perfilDe(A.id);
    expect(perfil?.targetRoles).toEqual(["abogacia"]);
    expect(perfil?.targetRole).toBe("abogacia");
    expect(perfil?.careerOther).toBeNull();
    expect(perfil?.careerAskedAt).not.toBeNull();

    // Ni en esta pantalla recargada ni en otra
    await page.reload();
    await expect(page.getByTestId("carrera-pedida")).toHaveCount(0);
    await page.goto("/hoy");
    await expect(page.getByTestId("carrera-pedida")).toHaveCount(0);
  });
});

test.describe("Flujo 391: «Otra» y «Ahora no»", () => {
  test.beforeAll(async () => {
    await crearPersonaAlta(B);
    await crearPersonaAlta(C);
  });

  test("«Otra» pide el texto, lo valida en el servidor y lo guarda", async ({ page }) => {
    await entrarComo(page, B);
    const recuadro = page.getByTestId("carrera-pedida");
    await expect(recuadro).toBeVisible();
    await expect(recuadro.getByLabel("Escribí tu carrera")).toHaveCount(0);

    await recuadro.getByRole("radio", { name: "Otra" }).check();
    const campo = recuadro.getByLabel("Escribí tu carrera");
    await expect(campo).toBeVisible();

    // Una marca de HTML no entra: error junto al campo y lo escrito se conserva
    await campo.fill("<b>Arquitectura</b>");
    await recuadro.getByRole("button", { name: "Guardar mi carrera" }).click();
    await expect(recuadro.getByRole("alert")).toContainText("sin enlaces");
    await expect(campo).toHaveValue("<b>Arquitectura</b>");
    await expect(campo).toHaveAttribute("aria-invalid", "true");

    await campo.fill("  Arquitectura   naval ");
    await recuadro.getByRole("button", { name: "Guardar mi carrera" }).click();
    await expect(page.getByTestId("carrera-pedida")).toHaveCount(0);
    await expect.poll(async () => (await perfilDe(B.id))?.careerAskedAt ?? null).not.toBeNull();

    const perfil = await perfilDe(B.id);
    expect(perfil?.careerOther).toBe("Arquitectura naval");
    expect(perfil?.targetRoles).toEqual([]);
    expect(perfil?.careerAskedAt).not.toBeNull();
    await page.reload();
    await expect(page.getByTestId("carrera-pedida")).toHaveCount(0);
  });

  test("«Ahora no» no vuelve a pedirla y no guarda ninguna carrera", async ({ page }) => {
    await entrarComo(page, C);
    await expect(page.getByTestId("carrera-pedida")).toBeVisible();
    await page.getByRole("button", { name: "Ahora no" }).click();
    await expect(page.getByTestId("carrera-pedida")).toHaveCount(0);
    await expect.poll(async () => (await perfilDe(C.id))?.careerAskedAt ?? null).not.toBeNull();
    const perfil = await perfilDe(C.id);
    expect(perfil?.targetRoles).toEqual([]);
    expect(perfil?.careerOther).toBeNull();
    await page.goto("/hoy");
    await expect(page.getByTestId("carrera-pedida")).toHaveCount(0);
  });

  test("una cuenta que ya tiene carrera no ve nada, y una con «Otra» tampoco", async ({ page }) => {
    await crearPersonaAlta(D, { targetRoles: ["fullstack"] });
    await entrarComo(page, D);
    await expect(page.getByTestId("carrera-pedida")).toHaveCount(0);
    await page.goto("/jobs");
    await expect(page.getByTestId("carrera-pedida")).toHaveCount(0);
    // Mismo resultado con la carrera escrita a mano y sin haberla «pedido» nunca
    await crearPersonaAlta(D, { careerOther: "Arquitectura" });
    await page.reload();
    await expect(page.getByTestId("carrera-pedida")).toHaveCount(0);
  });
});
