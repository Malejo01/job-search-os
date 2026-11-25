import { expect, test } from "@playwright/test";
import { and, eq, like } from "drizzle-orm";
import * as s from "@job-search-os/db/schema";
import {
  E2E_B_USER_ID,
  ensureSecondUser,
  loginAsSecondUser,
  ownerDb,
  removeSecondUser,
  seedSecondUserData,
} from "./helpers";

/**
 * Flujo 302 (R28-09): el teclado del celular no tapa los campos. Playwright no abre el teclado virtual: se
 * simula con una ventana de 360×300 (640 menos ~340 de teclado). Al enfocar el campo de respuesta de Interview,
 * el campo tiene que quedar a la vista y lo que está en ese punto tiene que ser el propio campo (no las
 * pestañas de abajo ni un botón flotante). Usa la persona B: no correrlo junto con 300 ni 301.
 */
test.use({ viewport: { width: 360, height: 300 } });
test.setTimeout(120_000);

test.beforeAll(async () => {
  await ensureSecondUser();
  await seedSecondUserData(`302-${Date.now()}`);
});

test.afterAll(async () => {
  const { db, close } = ownerDb();
  try {
    await db.delete(s.interviewSessions).where(eq(s.interviewSessions.userId, E2E_B_USER_ID));
    await db
      .delete(s.llmCalls)
      .where(and(eq(s.llmCalls.userId, E2E_B_USER_ID), like(s.llmCalls.label, "interview%")));
  } finally {
    await close();
  }
  await removeSecondUser();
});

test("con el teclado abierto el campo de respuesta de Interview queda a la vista y sin nada encima", async ({
  page,
}) => {
  await loginAsSecondUser(page);
  const { db, close } = ownerDb();
  let sessionId: string | undefined;
  try {
    const [job] = await db
      .select({ id: s.jobs.id })
      .from(s.jobs)
      .where(eq(s.jobs.userId, E2E_B_USER_ID))
      .limit(1);
    const [row] = await db
      .insert(s.interviewSessions)
      .values({
        userId: E2E_B_USER_ID,
        sourceKind: "job",
        jobId: job!.id,
        title: "Oferta Ficticia B · Empresa B",
        questions: [1, 2, 3, 4, 5].map((n) => `Pregunta ficticia número ${n} de la simulación`),
      })
      .returning({ id: s.interviewSessions.id });
    sessionId = row!.id;
  } finally {
    await close();
  }

  await page.goto(`/interview/${sessionId}`);
  const field = page.getByTestId("interview-answer");
  await expect(field).toBeVisible();
  await field.focus();
  await field.fill("Mi respuesta de prueba.");
  await page.waitForTimeout(300);

  const covered = await field.evaluate((el) => {
    const r = el.getBoundingClientRect();
    // El campo entra en la ventana (alto de 300 px) y el punto de su centro es el campo
    const cx = r.left + r.width / 2;
    const cy = Math.min(Math.max(r.top + Math.min(r.height, 40) / 2, 0), window.innerHeight - 1);
    const top = document.elementFromPoint(cx, cy);
    return {
      inView: r.top >= 0 && r.top < window.innerHeight,
      isField: top === el || el.contains(top),
    };
  });
  expect(covered.inView, "el campo está a la vista").toBe(true);
  expect(covered.isField, "nada tapa el campo").toBe(true);
});
