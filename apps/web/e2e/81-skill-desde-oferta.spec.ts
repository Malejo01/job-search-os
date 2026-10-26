import AxeBuilder from "@axe-core/playwright";
import * as s from "@job-search-os/db/schema";
import { expect, test, type Page } from "@playwright/test";
import { and, eq, inArray } from "drizzle-orm";
import { createJob, deleteJob, E2E_USER_ID, login, ownerDb, skillLevelsOf } from "./helpers";

/**
 * Flujo 81 (C-20): cargar el nivel de una skill desde el detalle de la oferta, en un modal, sin
 * salir de ella. Cubre los dos lugares (el pre-score de una oferta sin evaluar y «Requisitos del
 * aviso»), el guardado de una sola fila, Esc con el foco de vuelta, axe con el modal abierto y 390 px.
 * Avisos y datos inventados. Las skills de la prueba (`docker`, `kubernetes`) se dejan sin nivel al
 * empezar y se restauran al terminar.
 */
test.describe.configure({ mode: "serial" });

const SLUGS = ["docker", "kubernetes"];
const NOMBRE: Record<string, string> = { docker: "Docker", kubernetes: "Kubernetes" };

async function addJobSkills(jobId: string, slugs: string[]): Promise<void> {
  const { db, close } = ownerDb();
  try {
    const rows = await db
      .select({ id: s.skills.id })
      .from(s.skills)
      .where(inArray(s.skills.slug, slugs));
    if (rows.length !== slugs.length) throw new Error("faltan skills en la taxonomía");
    await db
      .insert(s.jobSkills)
      .values(rows.map((r) => ({ jobId, skillId: r.id, isMust: true, rawMention: "e2e" })));
  } finally {
    await close();
  }
}

async function evaluateWithChecklist(jobId: string, slug: string): Promise<void> {
  const skill = {
    id: `skill:${slug}`,
    kind: "skill",
    nivel: "deseable",
    pide: `Menciona ${NOMBRE[slug]}`,
    evidencia: null,
    tenes: null,
    status: "no_se_sabe",
    fuente: { pide: "fuente", tenes: null },
    bloquea: false,
  };
  const { db, close } = ownerDb();
  try {
    await db.insert(s.evaluations).values({
      jobId,
      userId: E2E_USER_ID,
      criteriaVersion: 1,
      promptVersion: "evaluate_job@e2e",
      model: "fake",
      hadFullJd: true,
      score: 6,
      locationOk: "ok",
      modality: "remoto",
      discipline: "ai_engineer",
      matchFuerte: [],
      gaps: [],
      bloqueadoresDuros: [],
      senalesPositivas: [],
      veredicto: "Evaluación de prueba (e2e).",
      accion: "guardar",
      decision: {
        checklist: {
          items: [skill],
          must: { cumple: 0, no_cumple: 0, no_se_sabe: 0 },
          deseable: { cumple: 0, no_cumple: 0, no_se_sabe: 1 },
          parcial: false,
          descarte_rapido: null,
        },
      },
    });
  } finally {
    await close();
  }
}

async function axeSummary(page: Page): Promise<string[]> {
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  return violations.map(
    (v) =>
      `${v.id} (${v.impact ?? "sin impacto"}): ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`,
  );
}

test.describe("Flujo 81: nivel de una skill desde la oferta", () => {
  const tag = Date.now();
  const jobIds: string[] = [];
  let levelsBackup: (typeof s.skillLevels.$inferSelect)[] = [];

  async function newJob(slugs: string[], status: "pendiente_jd" | "evaluada" = "pendiente_jd") {
    const jobId = await createJob({
      title: `E2E skill desde oferta ${tag} ${jobIds.length + 1}`,
      status,
      jdText: "Descripción ficticia del aviso de la prueba.",
    });
    jobIds.push(jobId);
    if (slugs.length) await addJobSkills(jobId, slugs);
    return jobId;
  }

  test.beforeAll(async () => {
    const { db, close } = ownerDb();
    try {
      const ids = (
        await db.select({ id: s.skills.id }).from(s.skills).where(inArray(s.skills.slug, SLUGS))
      ).map((r) => r.id);
      levelsBackup = await db
        .select()
        .from(s.skillLevels)
        .where(and(eq(s.skillLevels.userId, E2E_USER_ID), inArray(s.skillLevels.skillId, ids)));
      await db
        .delete(s.skillLevels)
        .where(and(eq(s.skillLevels.userId, E2E_USER_ID), inArray(s.skillLevels.skillId, ids)));
    } finally {
      await close();
    }
  });

  test.afterAll(async () => {
    for (const id of jobIds) await deleteJob(id).catch(() => {});
    const { db, close } = ownerDb();
    try {
      const ids = (
        await db.select({ id: s.skills.id }).from(s.skills).where(inArray(s.skills.slug, SLUGS))
      ).map((r) => r.id);
      await db
        .delete(s.skillLevels)
        .where(and(eq(s.skillLevels.userId, E2E_USER_ID), inArray(s.skillLevels.skillId, ids)))
        .catch(() => {});
      if (levelsBackup.length) {
        await db
          .insert(s.skillLevels)
          .values(levelsBackup)
          .catch(() => {});
      }
    } finally {
      await close().catch(() => {});
    }
  });

  test("abre el modal, pasa axe, Esc lo cierra y el foco vuelve al botón; sin elegir no guarda", async ({
    page,
  }) => {
    const jobId = await newJob(["docker"]);
    await page.setViewportSize({ width: 1280, height: 800 });
    await login(page);
    await page.goto(`/jobs/${jobId}`);

    const open = page.getByRole("button", { name: "Cargar mi nivel de Docker" });
    await expect(open).toBeVisible();
    await open.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Tu nivel de Docker" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("¿Qué es?");
    await expect(dialog.getByRole("radio")).toHaveCount(4);
    // axe con el modal abierto
    expect(await axeSummary(page)).toEqual([]);

    // Guardar sin elegir: el modal sigue abierto con el mensaje
    await dialog.getByRole("button", { name: "Guardar" }).click();
    await expect(dialog.getByRole("alert")).toContainText("Elegí uno de los cuatro niveles");
    await expect(dialog).toBeVisible();
    expect(await skillLevelsOf(E2E_USER_ID)).not.toHaveProperty("docker");

    // Esc cierra y devuelve el foco al botón que lo abrió
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(open).toBeFocused();
    expect(await skillLevelsOf(E2E_USER_ID)).not.toHaveProperty("docker");
  });

  test("oferta sin evaluar: elegir nivel 2 y Guardar cierra, no cambia la URL y guarda solo esa fila", async ({
    page,
  }) => {
    const jobId = await newJob(["docker", "kubernetes"]);
    await page.setViewportSize({ width: 1280, height: 800 });
    await login(page);
    await page.goto(`/jobs/${jobId}`);
    const url = page.url();
    const before = await skillLevelsOf(E2E_USER_ID);
    await expect(page.getByText("Sin nivel cargado (2)")).toBeVisible();

    await page.getByRole("button", { name: "Cargar mi nivel de Docker" }).click();
    const dialog = page.getByRole("dialog", { name: "Tu nivel de Docker" });
    await dialog.getByRole("radio", { name: "lo usé en un proyecto" }).check();
    await dialog.getByRole("button", { name: "Guardar" }).click();

    await expect(dialog).toBeHidden();
    expect(page.url()).toBe(url);
    // Se refresca sola: Docker sale de «Sin nivel cargado» y queda Kubernetes
    await expect(page.getByText("Sin nivel cargado (1)")).toBeVisible();
    await expect(page.getByRole("button", { name: "Cargar mi nivel de Docker" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Cargar mi nivel de Kubernetes" })).toBeVisible();

    // Una sola fila: el resto de los niveles quedó como estaba
    const after = await skillLevelsOf(E2E_USER_ID);
    expect(after.docker).toBe(2);
    expect({ ...after, docker: undefined }).toEqual({ ...before, docker: undefined });
    expect(after).not.toHaveProperty("kubernetes");

    // Ajustes la muestra con nivel 2
    await page.goto("/settings/skills");
    await expect(
      page.getByTestId("skill-docker").getByRole("radio", { name: "lo usé en un proyecto" }),
    ).toBeChecked();
  });

  test("Requisitos del aviso: el botón carga el nivel y el ítem lo muestra sin re-evaluar", async ({
    page,
  }) => {
    const jobId = await newJob([], "evaluada");
    await evaluateWithChecklist(jobId, "kubernetes");
    await page.setViewportSize({ width: 1280, height: 800 });
    await login(page);
    await page.goto(`/jobs/${jobId}`);
    const section = page.getByRole("region", { name: "Requisitos del aviso" });
    await expect(section.getByText("No se sabe", { exact: true })).toBeVisible();

    await section.getByRole("button", { name: "Cargar mi nivel de Kubernetes" }).click();
    const dialog = page.getByRole("dialog", { name: "Tu nivel de Kubernetes" });
    await dialog.getByRole("radio", { name: "lo uso con soltura" }).check();
    await dialog.getByRole("button", { name: "Guardar" }).click();

    await expect(dialog).toBeHidden();
    await expect(section.getByText("Nivel 3 de 3")).toBeVisible();
    await expect(section.getByText("Cumple", { exact: true })).toBeVisible();
    await expect(
      section.getByRole("button", { name: "Cargar mi nivel de Kubernetes" }),
    ).toHaveCount(0);
    expect((await skillLevelsOf(E2E_USER_ID)).kubernetes).toBe(3);
  });

  test("a 390 px el modal no se corta y sus botones miden 44 px", async ({ page }) => {
    // Ya hay nivel de las dos skills: se quita una para tener algo que cargar
    const { db, close } = ownerDb();
    try {
      const [row] = await db
        .select({ id: s.skills.id })
        .from(s.skills)
        .where(eq(s.skills.slug, "docker"));
      await db
        .delete(s.skillLevels)
        .where(and(eq(s.skillLevels.userId, E2E_USER_ID), eq(s.skillLevels.skillId, row!.id)));
    } finally {
      await close();
    }
    const jobId = await newJob(["docker"]);
    await page.setViewportSize({ width: 390, height: 800 });
    await login(page);
    await page.goto(`/jobs/${jobId}`);

    const open = page.getByRole("button", { name: "Cargar mi nivel de Docker" });
    expect((await open.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await open.click();
    const dialog = page.getByRole("dialog", { name: "Tu nivel de Docker" });
    await expect(dialog).toBeVisible();
    const box = (await dialog.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    expect(box.y + box.height).toBeLessThanOrEqual(800);
    for (const name of ["Guardar", "Cancelar"]) {
      const b = (await dialog.getByRole("button", { name }).boundingBox())!;
      expect(b.height, `botón ${name}`).toBeGreaterThanOrEqual(44);
    }
    for (const radio of await dialog.locator("label").all()) {
      expect((await radio.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    // Cancelar cierra y no guarda
    await dialog.getByRole("button", { name: "Cancelar" }).click();
    await expect(dialog).toBeHidden();
    expect(await skillLevelsOf(E2E_USER_ID)).not.toHaveProperty("docker");
  });
});
