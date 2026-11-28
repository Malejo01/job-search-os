import { expect, test } from "@playwright/test";
import {
  avisoFicticio,
  cardCalls,
  cardRow,
  cleanCards,
  createJobForB,
  deleteJobsOfB,
} from "./ficha-helpers";
import { loginAsSecondUser } from "./helpers";

/**
 * Flujo 375 (R31-03): una sola ficha por texto. Dos ofertas distintas con el MISMO aviso y tres pestañas abiertas
 * a la vez generan una sola ficha y una sola llamada al modelo, y ninguna fila dice quién la pidió. Datos
 * inventados. Requiere `JOB_CARD: "testers"` en el webServer de playwright.config.ts.
 */
test.describe("Flujo 375: una sola vez por texto", () => {
  const tag = `375-${Date.now()}`;
  const jdText = avisoFicticio(tag);
  const ids: string[] = [];
  let hash = "";

  test.beforeAll(async () => {
    const a = await createJobForB({ title: `E2E ficha una vez A ${tag}`, jdText });
    const b = await createJobForB({ title: `E2E ficha una vez B ${tag}`, jdText });
    ids.push(a.jobId, b.jobId);
    hash = a.hash!;
    await cleanCards([hash]);
  });
  test.afterAll(async () => {
    await cleanCards([hash]);
    await deleteJobsOfB(ids);
  });

  test("tres pestañas a la vez, dos ofertas con el mismo texto: una ficha y una llamada", async ({
    context,
  }) => {
    const first = await context.newPage();
    await loginAsSecondUser(first);
    const pages = [first, await context.newPage(), await context.newPage()];
    await Promise.all([
      pages[0]!.goto(`/jobs/${ids[0]}`),
      pages[1]!.goto(`/jobs/${ids[0]}`),
      pages[2]!.goto(`/jobs/${ids[1]}`),
    ]);
    for (const p of pages) {
      await expect(p.getByTestId("ficha-resumen")).toBeVisible({ timeout: 30_000 });
    }
    expect(await cardCalls(hash)).toHaveLength(1);
    expect(await cardRow(hash)).toMatchObject({ status: "lista", attempts: 1 });
  });
});
