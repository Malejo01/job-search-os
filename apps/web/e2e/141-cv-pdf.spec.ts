import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { minimalPdf } from "../test/cv-pdf";
import { login } from "./helpers";

/**
 * Flujo 141 (R12-12, D3): subir un CV en PDF en `/cv/perfil`. pdfjs-dist se carga con import dinámico, el
 * worker sale del propio sitio y el texto aparece en el cuadro para revisarlo; nada se manda al servidor
 * hasta tocar «Leer mi CV» (este flujo no lo toca: no gasta lectura). Un PDF escaneado muestra el mensaje
 * de pegar el texto. El servidor de los e2e corre con `CV_PROFILE_AGENT=testers` y la persona principal es
 * admin. CV inventado (`packages/pipeline/test/fixtures/cv-perfil/`).
 */
const CV_LINES = readFileSync(
  join(__dirname, "../../../packages/pipeline/test/fixtures/cv-perfil/con-experiencia.txt"),
  "utf8",
).split("\n");

test.describe("Flujo 141: CV en PDF leído en el navegador", () => {
  test("PDF de texto → el texto en el cuadro; PDF escaneado → pegar el texto", async ({ page }) => {
    const problems: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error" && /Content Security Policy|worker/i.test(m.text())) {
        problems.push(m.text());
      }
    });
    const external: string[] = [];
    const posts: string[] = [];
    page.on("request", (r) => {
      const url = new URL(r.url());
      if (url.hostname !== "localhost" && url.hostname !== "127.0.0.1") external.push(url.host);
      if (r.method() === "POST" && url.pathname.startsWith("/api/cv-perfil"))
        posts.push(url.pathname);
    });
    const worker = page.waitForRequest((r) => /\/_next\/static\/media\/pdf\.worker/.test(r.url()));

    await login(page);
    await page.goto("/cv/perfil");
    await expect(page.getByTestId("profile-read-zone")).toBeVisible();

    await page.locator('[data-testid="profile-read-zone"] input[type="file"]').setInputFiles({
      name: "cv-inventado.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from(minimalPdf(CV_LINES)),
    });
    const box = page.getByTestId("profile-read-text");
    await expect(box).toHaveValue(/Analista contable, Empresa C, 2019-03 a 2024-08/, {
      timeout: 30_000,
    });
    await expect(box).toHaveValue(/Inglés avanzado \(C1\)\./);
    await expect(page.getByRole("status")).toContainText("Leímos el texto de tu archivo");
    await expect(page.getByTestId("profile-read-notice")).toHaveCount(0);
    // El worker vino del propio sitio
    expect((await worker).url()).toMatch(/^http:\/\/localhost:\d+\/_next\/static\/media\//);

    // Escaneado: sin texto → el mensaje de pegar el texto, y el cuadro no se pisa
    await box.fill("");
    await page.locator('[data-testid="profile-read-zone"] input[type="file"]').setInputFiles({
      name: "cv-escaneado.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from(minimalPdf(null)),
    });
    await expect(page.getByTestId("profile-read-notice")).toContainText(
      "Si es un PDF escaneado o una imagen, no se puede leer. Pegá el texto de tu CV",
    );
    await expect(box).toHaveValue("");

    expect(problems).toEqual([]);
    expect(external).toEqual([]);
    expect(posts).toEqual([]);
  });
});
