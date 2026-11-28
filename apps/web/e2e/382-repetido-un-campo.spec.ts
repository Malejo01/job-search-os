import * as s from "@job-search-os/db/schema";
import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
// La persona B es la tester de `JOB_CARD=testers` (la A no entra a la etapa): todo el flujo es con B
import {
  E2E_B_USER_ID as E2E_USER_ID,
  ensureSecondUser,
  loginAsSecondUser as login,
  ownerDb,
} from "./helpers";
import { deleteJobs, JOB_CARD_MODE, seedEvaluatedJob } from "./evaluacion-r31-helpers";
import { ensureOffUser, loginAsOffUser, OFF_USER } from "./voz-helpers";

/**
 * Flujo 382 (R31-08): «Esto mismo te pasa en N de tus M ofertas». Dos ofertas evaluadas piden inglés y el perfil no
 * tiene el dato: el detalle lo dice y ofrece «Actualizar mi inglés», que abre solo ese campo. Al guardar, las dos
 * ofertas pasan a «Coincide» sin volver a evaluar y el resto del perfil no cambia. Con `JOB_CARD` apagada nada de
 * esto aparece (la R30 tal cual). Se siembra la tabla ya guardada; ningún modelo. Todo inventado.
 */
test.describe.configure({ mode: "serial" });

const FILA = "Inglés avanzado";

function checklistIngles() {
  return {
    items: [
      {
        id: "ingles",
        kind: "estructurado",
        nivel: "must",
        pide: FILA,
        evidencia: null,
        tenes: null,
        status: "no_se_sabe",
        fuente: { pide: "modelo", tenes: null },
        bloquea: false,
      },
    ],
    must: { cumple: 0, no_cumple: 0, no_se_sabe: 1 },
    deseable: { cumple: 0, no_cumple: 0, no_se_sabe: 0 },
    parcial: false,
    descarte_rapido: null,
  };
}

const jobIds: string[] = [];
let ofertaA = "";
let ofertaB = "";
let antes: { englishCefr: string | null; yearsTotal: number | null; displayName: string } | null =
  null;

async function leerPerfil() {
  const { db, close } = ownerDb();
  try {
    const [row] = await db
      .select({
        englishCefr: s.profiles.englishCefr,
        yearsTotal: s.profiles.yearsTotal,
        displayName: s.profiles.displayName,
      })
      .from(s.profiles)
      .where(eq(s.profiles.userId, E2E_USER_ID));
    return row ?? null;
  } finally {
    await close();
  }
}

async function ponerIngles(value: string | null) {
  const { db, close } = ownerDb();
  try {
    await db
      .update(s.profiles)
      .set({ englishCefr: value })
      .where(eq(s.profiles.userId, E2E_USER_ID));
  } finally {
    await close();
  }
}

test.beforeAll(async () => {
  await ensureSecondUser();
  antes = await leerPerfil();
  await ponerIngles(null);
  for (const tag of ["RA", "RB"]) {
    const j = await seedEvaluatedJob({
      userId: E2E_USER_ID,
      tag,
      title: `Repetido un campo ${tag}`,
      checklist: checklistIngles(),
    });
    jobIds.push(j.jobId);
  }
  [ofertaA, ofertaB] = jobIds as [string, string];
});
test.afterAll(async () => {
  await deleteJobs(jobIds);
  if (antes) await ponerIngles(antes.englishCefr);
});

test.describe("con JOB_CARD encendida", () => {
  test.skip(JOB_CARD_MODE !== "testers", "necesita JOB_CARD=testers (E2E_JOB_CARD_MODE)");

  test("el aviso se repite, el botón abre solo el inglés y las dos ofertas se actualizan", async ({
    page,
  }) => {
    await login(page);
    await page.goto(`/jobs/${ofertaA}`);
    const bloque = page.getByTestId("repetido");
    const frase = await bloque.getByTestId("repetido-frase").innerText();
    const m = /Esto mismo te pasa en (\d+) de tus (\d+) ofertas/.exec(frase);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeGreaterThanOrEqual(2);
    expect(Number(m![2])).toBeGreaterThanOrEqual(Number(m![1]));

    await bloque.getByRole("button", { name: "Actualizar mi inglés" }).click();
    const modal = page.getByRole("dialog", { name: "Actualizar mi inglés" });
    await expect(modal).toBeVisible();
    // Solo ese campo: una sola entrada, no la página de perfil entera
    await expect(modal.getByRole("combobox")).toHaveCount(1);
    await expect(modal.getByRole("textbox")).toHaveCount(0);
    await modal.getByLabel("Tu nivel de inglés").selectOption("C1");
    await modal.getByRole("button", { name: "Guardar", exact: true }).click();
    await expect(modal).toBeHidden();

    // Se guardó ese dato y nada más
    const despues = await leerPerfil();
    expect(despues?.englishCefr).toBe("C1");
    expect(despues?.yearsTotal).toBe(antes?.yearsTotal ?? null);
    expect(despues?.displayName).toBe(antes?.displayName);

    // Las dos ofertas pasan a «Coincide» sin evaluar de nuevo
    for (const id of [ofertaA, ofertaB]) {
      await page.goto(`/jobs/${id}`);
      const fila = page.getByRole("listitem").filter({ hasText: FILA });
      await expect(fila.getByText("Coincide", { exact: true })).toBeVisible();
    }
  });

  test("un valor inválido no se guarda y el modal sigue abierto", async ({ page }) => {
    await ponerIngles(null);
    await login(page);
    await page.goto(`/jobs/${ofertaB}`);
    await page
      .getByTestId("repetido")
      .getByRole("button", { name: "Actualizar mi inglés" })
      .click();
    const modal = page.getByRole("dialog", { name: "Actualizar mi inglés" });
    // «required»: sin elegir nivel el formulario no se envía
    await modal.getByRole("button", { name: "Guardar", exact: true }).click();
    await expect(modal).toBeVisible();
    expect((await leerPerfil())?.englishCefr).toBeNull();
    // Esc cierra y el foco vuelve al botón
    await page.keyboard.press("Escape");
    await expect(modal).toBeHidden();
    await expect(
      page.getByTestId("repetido").getByRole("button", { name: "Actualizar mi inglés" }),
    ).toBeFocused();
  });
});

test.describe("fuera de la etapa de JOB_CARD", () => {
  // Una persona sin rol no está en `JOB_CARD=testers`: ve la R30 tal cual, con dos ofertas que piden inglés
  test("no aparece «Esto mismo te pasa…»", async ({ page }) => {
    // `ensureOffUser()` devuelve el id de una sesión de Interview, no el de la persona: va OFF_USER.id
    await ensureOffUser();
    const offUserId = OFF_USER.id;
    const propias: string[] = [];
    try {
      for (const tag of ["NA", "NB"]) {
        const j = await seedEvaluatedJob({
          userId: offUserId,
          tag,
          title: `Repetido sin rol ${tag}`,
          checklist: checklistIngles(),
        });
        propias.push(j.jobId);
      }
      await loginAsOffUser(page);
      await page.goto(`/jobs/${propias[0]}`);
      await expect(page.getByTestId("como-encaja")).toBeVisible();
      await expect(page.getByTestId("repetido")).toHaveCount(0);
    } finally {
      await deleteJobs(propias);
    }
  });
});
