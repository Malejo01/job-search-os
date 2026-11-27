import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import * as s from "@job-search-os/db/schema";
import { E2E_USER_ID, login, ownerDb } from "./helpers";

/**
 * Flujo 421 (R33-07 y R33-09): contacto y links del CV, la vista previa que se actualiza sola, el aviso
 * antes de descargar y los avisos de calidad. Datos inventados; los links guardados y la entrada del
 * historial se restauran al final.
 */
const EMPRESA = `Empresa Ficticia Calidad ${Date.now()}`;
const TAREA = "Ejecuté tareas de retail en el área comercial";
const LINKEDIN = "https://linkedin.example.com/in/persona-ficticia";

test.describe.configure({ mode: "serial" });

let originalLinks: unknown = null;
let hadRow = false;

test.beforeAll(async () => {
  const { db, close } = ownerDb();
  try {
    const [row] = await db
      .select({ links: s.applicationSettings.links })
      .from(s.applicationSettings)
      .where(eq(s.applicationSettings.userId, E2E_USER_ID));
    hadRow = !!row;
    originalLinks = row?.links ?? {};
    await db.delete(s.careerHistory).where(eq(s.careerHistory.organization, EMPRESA));
    await db.insert(s.careerHistory).values({
      userId: E2E_USER_ID,
      kind: "trabajo",
      organization: EMPRESA,
      title: "Asistente comercial",
      startMonth: "2022-03",
      endMonth: null,
      bullets: [TAREA],
      source: "manual",
      sort: 910,
    });
  } finally {
    await close();
  }
});

test.afterAll(async () => {
  const { db, close } = ownerDb();
  try {
    await db.delete(s.careerHistory).where(eq(s.careerHistory.organization, EMPRESA));
    if (hadRow) {
      await db
        .update(s.applicationSettings)
        .set({ links: originalLinks as Record<string, string> })
        .where(eq(s.applicationSettings.userId, E2E_USER_ID));
    } else {
      await db.delete(s.applicationSettings).where(eq(s.applicationSettings.userId, E2E_USER_ID));
    }
  } finally {
    await close();
  }
});

test.describe("Flujo 421: contacto, links y calidad del CV", () => {
  test("la vista previa se actualiza sola al cambiar el idioma y ciudad y país vienen marcados", async ({
    page,
  }) => {
    await login(page);
    await page.goto("/cv");
    const opciones = page.getByTestId("cv-opciones");
    await expect(opciones.getByLabel("Incluir ciudad y país")).toBeChecked();
    await expect(opciones).toContainText("Incluye ciudad y país, no tu dirección.");
    // Sin botón «Actualizar vista previa»: cambia sola
    await expect(page.getByRole("button", { name: "Actualizar vista previa" })).toHaveCount(0);
    await opciones.getByLabel("Idioma").selectOption("en");
    await page.waitForURL(/lang=en/);
    await expect(
      page.getByTestId("cv-preview").getByRole("heading", { name: "Experience", level: 2 }),
    ).toBeVisible();
    // Un solo idioma en los títulos
    await opciones.getByLabel("Idioma").selectOption("es");
    await page.waitForURL(/lang=es/);
    const preview = page.getByTestId("cv-preview");
    await expect(preview.getByRole("heading", { name: "Experiencia", level: 2 })).toBeVisible();
    await expect(preview).toContainText("03/2022 – Actualidad");
    // El teléfono es opcional: hay un campo para cargarlo, y mientras no haya uno guardado no hay casilla
    // «Incluir mi teléfono» (y por defecto, aun guardado, viene sin marcar: ver el test de teléfono)
    await expect(page.getByTestId("cv-links").getByLabel("Teléfono (opcional)")).toHaveCount(1);
    await expect(page.getByTestId("cv-incluir-telefono")).toHaveCount(0);
  });

  test("links: solo https, sin repetir lo escrito; guardado, van completos en el encabezado y se pueden sacar", async ({
    page,
  }) => {
    await login(page);
    await page.goto("/cv");
    const form = page.getByTestId("cv-links");
    await form.getByLabel("LinkedIn").fill("http://linkedin.example.com/in/persona-ficticia");
    await form.getByRole("button", { name: "Guardar links" }).click();
    const alerta = form.getByRole("alert");
    await expect(alerta).toContainText("https://");
    await expect(alerta).not.toContainText("persona-ficticia");

    await form.getByLabel("LinkedIn").fill(LINKEDIN);
    const abrir = form.getByRole("link", { name: /Abrir para probarlo/ });
    await expect(abrir).toHaveAttribute("href", LINKEDIN);
    await expect(abrir).toHaveAttribute("target", "_blank");
    await expect(abrir).toHaveAttribute("rel", /noopener/);
    await form.getByRole("button", { name: "Guardar links" }).click();
    await expect(form.getByText("Guardado.")).toBeVisible();

    const preview = page.getByTestId("cv-preview");
    await expect(preview).toContainText(`LinkedIn: ${LINKEDIN}`);
    // Se puede sacar del CV sin borrar el link guardado
    await page.getByTestId("cv-opciones").getByLabel("Incluir mi LinkedIn").uncheck();
    await expect(preview).not.toContainText(LINKEDIN);
    await expect(form.getByLabel("LinkedIn")).toHaveValue(LINKEDIN);

    // La descarga respeta lo mismo que la vista previa
    const sin = await page.request.get("/api/cv/docx?lang=es&linkedin=0");
    expect((await sin.body()).toString("utf8")).not.toContain(LINKEDIN);
    const con = await page.request.get("/api/cv/docx?lang=es&linkedin=1");
    expect((await con.body()).toString("utf8")).toContain(LINKEDIN);
  });

  test("teléfono opcional sin marcar y cuarto link con su nombre; el número nunca va en la URL", async ({
    page,
  }) => {
    const TEL = "+00 00 5555-0123";
    const OTRO = "https://behance.example.com/persona-ficticia";
    await login(page);
    await page.goto("/cv");
    const form = page.getByTestId("cv-links");
    await form.getByLabel("Teléfono (opcional)").fill("llamame");
    await form.getByRole("button", { name: "Guardar links" }).click();
    await expect(form.getByRole("alert")).toContainText("solo con números");
    await form.getByLabel("Teléfono (opcional)").fill(TEL);
    await form.getByLabel(/Otro link/).fill(OTRO);
    await form.getByLabel(/Nombre del otro link/).fill("Behance");
    await form.getByRole("button", { name: "Guardar links" }).click();
    await expect(form.getByText("Guardado.")).toBeVisible();

    const preview = page.getByTestId("cv-preview");
    await expect(preview).toContainText(`Behance: ${OTRO}`);
    // Sin marcar por defecto: el teléfono no sale hasta que se marca
    const marca = page.getByTestId("cv-incluir-telefono");
    await expect(marca).not.toBeChecked();
    await expect(preview).not.toContainText(TEL);
    await marca.check();
    await expect(preview).toContainText(TEL);
    // En la URL solo va la marca
    expect(page.url()).toContain("tel=1");
    expect(decodeURIComponent(page.url())).not.toContain("5555");

    const con = await page.request.get("/api/cv/docx?lang=es&tel=1");
    expect((await con.body()).toString("utf8")).toContain(TEL);
    const sin = await page.request.get("/api/cv/docx?lang=es");
    expect((await sin.body()).toString("utf8")).not.toContain(TEL);
  });

  test("aviso antes de descargar un CV incompleto: completar o descargar igual", async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await login(page);
    await page.goto("/cv");
    await page.getByTestId("cv-descargar-pdf").click();
    const aviso = page.getByTestId("cv-aviso-descarga");
    await expect(aviso).toContainText("Tu CV todavía no tiene");
    await expect(aviso).toContainText("¿Completarlo antes?");
    await expect(aviso.getByRole("link", { name: "Completar" })).toBeVisible();
    const descarga = page.waitForEvent("download");
    await page.getByTestId("cv-descargar-igual").click();
    expect((await descarga).suggestedFilename()).toMatch(/\.pdf$/);
  });

  test("avisos de calidad: viñeta de tarea con preguntas guía con sus palabras; nada se inventa", async ({
    page,
  }) => {
    await login(page);
    await page.goto("/cv");
    const tareas = page.getByTestId("cv-aviso-tareas");
    await expect(tareas).toBeVisible();
    await tareas.getByText(TAREA).first().click();
    await expect(tareas).toContainText(`«${TAREA}»`);
    await expect(tareas).toContainText("Lo que no mediste, no lo sumes");
    // El CV conserva la viñeta tal cual, sin una cifra ni un resultado agregado
    await expect(page.getByTestId("cv-preview")).toContainText(TAREA);
    const res = await page.request.get("/api/cv/docx?lang=es");
    const texto = (await res.body()).toString("utf8");
    expect(texto).toContain(`• ${TAREA}`);
    expect(texto).not.toContain("Español");
  });
});
