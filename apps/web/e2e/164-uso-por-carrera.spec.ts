import * as s from "@job-search-os/db/schema";
import { expect, test } from "@playwright/test";
import { inArray } from "drizzle-orm";
import { login, ownerDb } from "./helpers";
import { ensureSeedPerson } from "./persona-qa";

/**
 * Flujo 164 (R22-04): «Uso por carrera y por semana» en `/admin/metricas` (solo admin). El spec crea sus
 * propias personas ficticias: 3 con una carrera (se ven) y 2 con otra (quedan en «menos de 3» y la carrera
 * ni aparece). Comprueba la regla de k = 3, que no se filtra ningún email ni nombre y que no hay fila de total.
 * Que una cuenta común no la ve lo cubre el 140; axe y el desborde horizontal, el 77 y el 102.
 */
test.describe.configure({ mode: "serial" });

const SHOWN = "creacion_contenido"; // «Creación de contenido»: 3 personas
const HIDDEN = "edicion_video"; // 2 personas
const ID = (n: number) => `e9640000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const PEOPLE = [1, 2, 3, 4, 5].map(ID);

async function clean(): Promise<void> {
  const { db, close } = ownerDb();
  try {
    await db.delete(s.jobs).where(inArray(s.jobs.userId, PEOPLE)); // cae en cascada las postulaciones
    await db.delete(s.profiles).where(inArray(s.profiles.userId, PEOPLE));
    await db.delete(s.users).where(inArray(s.users.id, PEOPLE));
  } finally {
    await close();
  }
}

async function seed(): Promise<void> {
  const { db, close } = ownerDb();
  try {
    for (const [i, id] of PEOPLE.entries()) {
      await db
        .insert(s.users)
        .values({ id, email: `uso-carrera-${i}@example.com`, name: "Persona ficticia" });
      await db.insert(s.profiles).values({
        userId: id,
        displayName: "Persona ficticia",
        locationCountry: "AR",
        inboundAddress: `uso-carrera-e2e-${i}`,
        targetRoles: [i < 3 ? SHOWN : HIDDEN],
      });
      const [job] = await db
        .insert(s.jobs)
        .values({
          userId: id,
          companyRaw: "Empresa A",
          title: "Puesto A",
          titleNormalized: "puesto a",
        })
        .returning({ id: s.jobs.id });
      await db.insert(s.applications).values({ jobId: job!.id, userId: id });
    }
  } finally {
    await close();
  }
}

test.describe("Flujo 164: uso por carrera", () => {
  test.skip(!process.env.ADMIN_EMAILS, "sin ADMIN_EMAILS la cuenta del e2e no es admin");
  test.beforeAll(async () => {
    // La persona de prueba (admin) la crea el helper si la base local no trae al usuario del seed (R26-07)
    await ensureSeedPerson();
    await clean();
    await seed();
  });
  test.afterAll(clean);

  test("la carrera con 3 personas se ve; la de 2 no aparece; sin emails ni total", async ({
    page,
  }) => {
    await login(page);
    const response = await page.goto("/admin/metricas");
    test.skip(response?.status() === 404, "El usuario e2e no es admin en este entorno");
    const panel = page.getByTestId("uso-por-carrera");
    await expect(panel).toBeVisible();
    await expect(panel).toContainText("Uso por carrera y por semana");
    await expect(panel).toContainText("menos de 3");

    const card = panel.locator(`[data-role="${SHOWN}"]`);
    await expect(card).toHaveCount(1);
    await card.locator("summary").click(); // abre el <details>
    const rows = card.locator("tbody tr");
    await expect(rows).toHaveCount(8);
    // la primera fila es la semana en curso: 3 personas activas y 3 postulaciones
    const first = rows.first().locator("td");
    await expect(first.nth(0)).toHaveText("3"); // activas
    await expect(first.nth(4)).toHaveText("3"); // postulaciones
    // una fila anterior no tiene nada: «menos de 3», no «0»
    await expect(rows.last().locator("td").nth(0)).toContainText("menos de 3");

    await expect(panel.locator(`[data-role="${HIDDEN}"]`)).toHaveCount(0);
    await expect(panel.locator('[data-role="total"]')).toHaveCount(0);
    await expect(panel).not.toContainText("example.com");
    await expect(panel).not.toContainText("Persona ficticia");
  });
});
