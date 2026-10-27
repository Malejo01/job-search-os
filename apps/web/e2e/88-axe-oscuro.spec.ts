import * as s from "@job-search-os/db/schema";
import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { axeSummary } from "./axe-helpers";
import {
  createEvaluation,
  createInboundEmail,
  createJob,
  deleteInboundEmails,
  deleteJob,
  login,
  ownerDb,
} from "./helpers";

/**
 * Flujo 88 (N3): axe en modo oscuro de las pantallas ya migradas a los tokens (docs/ux/tokens.md).
 * Cada PR que migra una pantalla la suma a `ROUTES`. El oscuro se activa con la preferencia
 * `jso-tema` en localStorage, como lo haría una persona; el claro ya lo cubre el flujo 70.
 */

const VIEWPORTS = [
  { name: "360x740", width: 360, height: 740 },
  { name: "1280x800", width: 1280, height: 800 },
] as const;

type Seeded = { jobId: string; emailId: string };

/** Ruta fija, o función que la arma con lo sembrado (el detalle necesita una oferta). */
const ROUTES: Array<{ label: string; path: string | ((ids: Seeded) => string) }> = [
  { label: "/hoy", path: "/hoy" },
  { label: "/jobs", path: "/jobs" },
  { label: "/jobs/[id]", path: (ids) => `/jobs/${ids.jobId}` },
  { label: "/plan", path: "/plan" },
  { label: "/encaje", path: "/encaje" },
  { label: "/market", path: "/market" },
  { label: "/applications", path: "/applications" },
  { label: "/jobs/new", path: "/jobs/new" },
  { label: "/jobs/pending-jd", path: "/jobs/pending-jd" },
  { label: "/inbox", path: "/inbox" },
  { label: "/inbox/[id]", path: (ids) => `/inbox/${ids.emailId}` },
];

test.describe("Flujo 88: axe en oscuro", () => {
  const tag = Date.now();
  const seeded: Seeded = { jobId: "", emailId: "" };

  test.beforeAll(async () => {
    // Con riesgos y bloqueadores: el detalle muestra sus avisos ámbar y rojo, lo que más arriesga contraste
    seeded.jobId = await createJob({
      title: `Oferta Ficticia Oscuro ${tag}`,
      status: "evaluada",
      jdText: "Descripción ficticia para el flujo de axe en oscuro.",
    });
    await createEvaluation(seeded.jobId, { score: 6, accion: "aplicar" });
    const { db, close } = ownerDb();
    try {
      await db
        .update(s.evaluations)
        .set({
          matchFuerte: ["TypeScript ficticio"],
          gaps: ["Skill ficticia que falta"],
          bloqueadoresDuros: ["Bloqueador ficticio"],
          riesgos: ["Riesgo ficticio"],
        })
        .where(eq(s.evaluations.jobId, seeded.jobId));
    } finally {
      await close();
    }
    const email = await createInboundEmail({
      subject: `Email ficticio oscuro ${tag}`,
      text: "Cuerpo ficticio para el flujo de axe en oscuro.",
    });
    seeded.emailId = email.id;
  });

  test.afterAll(async () => {
    await deleteJob(seeded.jobId).catch(() => {});
    await deleteInboundEmails(`Email ficticio oscuro ${tag}`).catch(() => {});
  });

  for (const viewport of VIEWPORTS) {
    for (const route of ROUTES) {
      test(`${route.label} a ${viewport.name}: sin violaciones de axe en oscuro`, async ({
        page,
      }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.addInitScript(() => localStorage.setItem("jso-tema", "oscuro"));
        await login(page);
        await page.goto(typeof route.path === "function" ? route.path(seeded) : route.path);
        await expect(page.locator("html")).toHaveClass(/\bdark\b/);
        await expect(page.locator("h1").first()).toBeVisible();
        await page.waitForLoadState("networkidle");
        const { violations, unmeasured } = await axeSummary(page);
        expect(violations, `Violaciones en ${route.label} (oscuro, ${viewport.name})`).toEqual([]);
        expect(unmeasured, `axe no midió el contraste en ${route.label} (oscuro)`).toEqual([]);
      });
    }
  }
});
