import { CALIBRATION_CSV_HEADER } from "@job-search-os/pipeline";
import { expect, test } from "@playwright/test";
import {
  E2E_B_EMAIL,
  E2E_B_USER_ID,
  E2E_USER_ID,
  ensureSecondUser,
  login,
  loginAsSecondUser,
  removeSecondUser,
} from "./helpers";
import {
  deleteJobs,
  ensureAppAdmin,
  JOB_CARD_MODE,
  seedEvaluatedJob,
  verdictOf,
} from "./evaluacion-r31-helpers";

/**
 * Flujo 376 (R31-10): kit para calibrar la evaluación nueva, con `JOB_CARD=testers`. Una tester (la persona B) ve
 * sus ofertas evaluadas con `evaluate_job@v1.5.0` (las de versiones viejas no entran), marca una y queda en la
 * evaluación; el admin exporta lo marcado en un CSV sin datos personales; quien no es admin recibe 404 en la
 * exportación. Todo inventado.
 */
test.describe.configure({ mode: "serial" });
test.skip(
  JOB_CARD_MODE !== "testers" || !process.env.ADMIN_EMAILS,
  "necesita JOB_CARD=testers (E2E_JOB_CARD_MODE) y ADMIN_EMAILS",
);

const jobIds: string[] = [];
let nuevaId = "";

test.beforeAll(async () => {
  await ensureSecondUser();
  await ensureAppAdmin(E2E_USER_ID);
  const base = { userId: E2E_B_USER_ID };
  const a = await seedEvaluatedJob({
    ...base,
    tag: "A",
    title: "Calibración Abogacía Societario",
    discipline: "abogacia",
    blockers: ["Modalidad presencial"],
  });
  const b = await seedEvaluatedJob({
    ...base,
    tag: "B",
    title: "Calibración Contaduría Impuestos",
    discipline: "finanzas_contabilidad",
  });
  const c = await seedEvaluatedJob({
    ...base,
    tag: "C",
    title: "Calibración Programación Backend",
    discipline: "backend",
  });
  // Una evaluación de la versión vieja: no entra al kit
  const vieja = await seedEvaluatedJob({
    ...base,
    tag: "V",
    title: "Calibración Oferta Vieja",
    promptVersion: "evaluate_job@v1.4.0",
  });
  jobIds.push(a.jobId, b.jobId, c.jobId, vieja.jobId);
  nuevaId = a.jobId;
});
test.afterAll(async () => {
  await deleteJobs(jobIds);
  await removeSecondUser();
});

test("una tester ve solo las ofertas con la evaluación nueva y marca una", async ({ page }) => {
  await loginAsSecondUser(page);
  const res = await page.goto("/calibracion");
  expect(res?.status()).toBe(200);
  await expect(
    page.getByRole("heading", { level: 1, name: "Calibrar la evaluación nueva" }),
  ).toBeVisible();
  await expect(page.getByTestId("calibracion-progreso")).toContainText("Marcaste 0 de 3");
  await expect(page.getByTestId("calibracion-oferta")).toHaveCount(3);
  await expect(page.getByText("Calibración Oferta Vieja")).toHaveCount(0);

  const primera = page
    .getByTestId("calibracion-oferta")
    .filter({ hasText: "Calibración Abogacía Societario" });
  await expect(primera.getByText("Condiciones del aviso: 1")).toBeVisible();
  await primera.getByRole("button", { name: "Sí, me sirve", exact: true }).click();
  await expect.poll(async () => (await verdictOf(nuevaId))?.humanVerdict).toBe("de_acuerdo");

  await page.reload();
  await expect(page.getByTestId("calibracion-progreso")).toContainText("Marcaste 1 de 3");
  // Una tester que no es admin no tiene botón de exportar
  await expect(page.getByTestId("calibracion-exportar")).toHaveCount(0);
});

test("quien no es admin recibe 404 en la exportación", async ({ page }) => {
  await loginAsSecondUser(page);
  const res = await page.request.get("/admin/calibracion/export");
  expect(res.status()).toBe(404);
});

test("el admin exporta lo marcado, sin datos personales", async ({ page }) => {
  await login(page);
  await page.goto("/calibracion");
  await expect(page.getByTestId("calibracion-exportar")).toBeVisible();
  const res = await page.request.get("/admin/calibracion/export");
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("text/csv");
  expect(res.headers()["content-disposition"]).toContain("calibracion-evaluacion-nueva.csv");
  const csv = (await res.text()).replace(String.fromCharCode(0xfeff), "");
  const rows = csv.trimEnd().split("\r\n");
  expect(rows[0]).toBe(CALIBRATION_CSV_HEADER);
  expect(rows.length).toBeGreaterThanOrEqual(2);
  expect(csv).toContain('"de acuerdo"');
  // Sin email, sin nombre y sin el id de la cuenta
  expect(csv).not.toContain(E2E_B_EMAIL);
  expect(csv).not.toContain("Persona B");
  expect(csv).not.toContain(E2E_B_USER_ID);
  expect(csv).not.toMatch(/@/);
  // La oferta es de la persona (no del pool): sin título ni empresa
  expect(csv).not.toContain("Calibración Abogacía Societario");
  // La versión vieja no sale
  expect(csv).not.toContain("evaluate_job@v1.4.0");
});
