import * as s from "@job-search-os/db/schema";
import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { borrarPersonaAlta, crearPersonaAlta, entrarComo, type PersonaAlta } from "./alta-helpers";
import { closePrivacyDialog, ownerDb } from "./helpers";

/**
 * Flujo 396 (R32-04): guía de alertas paso a paso y por carrera, en Ajustes › Email entrante. Con dos carreras, las
 * palabras van agrupadas por carrera; cada portal trae sus pasos (con cómo hacer que los emails lleguen a la
 * dirección de la app) y cuántas ofertas llegaron por ese portal en 30 días. La app no crea alertas ni entra a
 * ningún portal. Persona inventada.
 */
const P: PersonaAlta = {
  id: "c0000000-0000-4000-8000-000000000398",
  email: `guia-alertas-${Date.now()}@ejemplo.test`,
  password: "clave-e2e-guia-alertas-local",
  name: "Persona Guia Alertas",
};

test.use({ viewport: { width: 390, height: 844 } });

test.beforeAll(async () => {
  await crearPersonaAlta(P, {
    targetRoles: ["abogacia", "comunicacion"],
    careerAskedAt: new Date(),
  });
  // Una oferta que le llegó por un email de LinkedIn en los últimos 30 días
  const { db, close } = ownerDb();
  try {
    const [job] = await db
      .insert(s.jobs)
      .values({
        userId: P.id,
        companyRaw: "Empresa A",
        title: "Abogada junior (oferta ficticia 396)",
        titleNormalized: "abogada junior oferta ficticia 396",
        status: "prefiltrada",
        flags: [],
        jdText: "Descripción ficticia.",
      })
      .returning({ id: s.jobs.id });
    await db.insert(s.jobSources).values({
      jobId: job!.id,
      kind: "email_linkedin",
      sourceName: "LinkedIn (alerta)",
      externalId: "e2e-396-1",
      url: "https://example.com/e2e-396/1",
      seenAt: new Date(),
    });
  } finally {
    await close();
  }
});
test.afterAll(async () => {
  const { db, close } = ownerDb();
  try {
    await db.delete(s.jobs).where(eq(s.jobs.userId, P.id));
  } finally {
    await close();
  }
  await borrarPersonaAlta(P.id).catch(() => {});
});

test("Flujo 396: palabras por carrera, pasos por portal y cuántas llegaron por cada uno", async ({
  page,
}) => {
  await entrarComo(page, P);
  await page.goto("/settings/asistente");
  // El aviso de privacidad se abre solo la primera vez
  await page
    .getByRole("dialog")
    .waitFor({ state: "visible", timeout: 3000 })
    .then(() => closePrivacyDialog(page))
    .catch(() => {});
  const guia = page.getByTestId("alert-guide");
  await expect(guia).toBeVisible();
  await expect(guia.getByTestId("alert-guide-aclaracion")).toContainText("nosotros no las creamos");

  // Palabras agrupadas por carrera
  const abogacia = guia.getByTestId("alert-career-abogacia");
  const comunicacion = guia.getByTestId("alert-career-comunicacion");
  await expect(abogacia.getByRole("heading", { name: "Para Abogacía" })).toBeVisible();
  await expect(abogacia.getByTestId("alert-keyword").filter({ hasText: "abogado" })).toHaveCount(1);
  await expect(comunicacion.getByRole("heading", { name: "Para Comunicación" })).toBeVisible();
  await expect(
    comunicacion.getByTestId("alert-keyword").filter({ hasText: "periodista" }),
  ).toHaveCount(1);
  await expect(guia.getByRole("button", { name: "Copiar todas las palabras" })).toHaveCount(1);

  // Pasos de LinkedIn, con la forma de recibir las alertas en la app
  const linkedin = guia.getByTestId("alert-portal-linkedin");
  const pasos = linkedin.getByTestId("alert-steps-linkedin");
  await pasos.getByText("Paso a paso en LinkedIn").click();
  await expect(pasos.getByRole("listitem")).toHaveCount(4);
  await expect(pasos).toContainText("Reenviá cada email a tu dirección");
  // Cuántas llegaron por ese portal
  await expect(linkedin.getByTestId("alert-portal-linkedin-count")).toContainText(
    "Te llegó 1 oferta de LinkedIn en los últimos 30 días",
  );
  // Un portal que leemos solos y todavía no mandó nada
  await expect(
    guia.getByTestId("alert-portal-bumeran").getByTestId("alert-portal-bumeran-count"),
  ).toContainText("Todavía no te llegó ninguna oferta de Bumeran");
  // Un portal que no leemos: se pega el aviso, y no cuenta ofertas que no puede ver
  const zona = guia.getByTestId("alert-portal-zonajobs");
  await zona.getByText("Paso a paso en ZonaJobs").click();
  await expect(zona.getByTestId("alert-steps-zonajobs")).toContainText(
    "Todavía no leemos los emails",
  );
  await expect(zona.getByTestId("alert-portal-zonajobs-count")).toHaveCount(0);
});
