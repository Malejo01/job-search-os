import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildPlanNoticeEmail,
  buildWelcomeEmail,
  EMAIL_MASCOTA,
  MASCOTA_NOMBRE as NOMBRE_PIPELINE,
} from "@job-search-os/pipeline";
import { describe, expect, it } from "vitest";

/** R27-06: lo que sale de la app (emails, favicon). Lee los archivos reales del repo. */
const WEB = join(__dirname, "..");
const pub = (f: string) => join(WEB, "public", "mascota", f);
const app = (f: string) => join(WEB, "app", f);

function pngSize(file: string): { w: number; h: number } {
  const b = readFileSync(file);
  expect(b.subarray(1, 4).toString("latin1")).toBe("PNG");
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

describe("imagen de los emails", () => {
  it("el ancho declarado sale de proporcionar el PNG de 512 px a 160 px de alto", () => {
    const { w, h } = pngSize(pub("saludando-512.png"));
    expect(EMAIL_MASCOTA.path).toBe("/mascota/saludando-512.png");
    expect(h).toBe(512);
    expect(Math.round((w * EMAIL_MASCOTA.height) / h)).toBe(EMAIL_MASCOTA.width);
  });

  it("el nombre de la mascota de los emails es el mismo que el de la interfaz", async () => {
    const ui = await import("../lib/mascota");
    expect(ui.MASCOTA_NOMBRE).toBe(NOMBRE_PIPELINE);
  });
});

describe("R29-08: la v2 en emails, OG y favicon", () => {
  const png = pngSize(pub("saludando-512.png"));
  const base = "https://app.example";

  it("el email de bienvenida y el de vencimiento apuntan a la imagen v2 con 114 x 160 px", () => {
    const bienvenida = buildWelcomeEmail({
      displayName: "Persona Ficticia",
      until: new Date("2026-12-31T15:00:00Z"),
      becado: false,
      appUrl: base,
      contactEmail: null,
      cvEnabled: true,
    }).html;
    const vencimiento = buildPlanNoticeEmail({
      displayName: "Persona Ficticia",
      until: new Date("2026-12-10T12:00:00Z"),
      paymentUrl: "https://pago.example/abc",
      settingsUrl: `${base}/settings#tu-plan`,
      contactEmail: null,
      becado: false,
    }).html;
    for (const html of [bienvenida, vencimiento]) {
      const img = html.match(/<img\b[^>]*>/)?.[0] ?? "";
      expect(img).toContain(`src="${base}/mascota/saludando-512.png"`);
      expect(img).toContain('width="114"');
      expect(img).toContain('height="160"');
      expect(img).toContain("width:114px;height:160px");
    }
    // El ancho sale de la proporción real del PNG de la v2 (si cambia la imagen, cambia este número)
    expect(Math.round((png.w * 160) / png.h)).toBe(114);
  });

  it("la muestra de /admin/marca usa el mismo email (misma imagen y tamaño)", () => {
    const src = readFileSync(join(WEB, "lib", "welcome-email-sample.ts"), "utf8");
    expect(src).toContain("buildWelcomeEmail");
  });

  it("la imagen OG lee el mismo PNG de los emails y conserva su proporción", () => {
    const og = readFileSync(join(WEB, "lib", "og-image.tsx"), "utf8");
    expect(og).toContain(`"public${EMAIL_MASCOTA.path}"`);
    expect(og).toContain("EMAIL_MASCOTA.width");
    expect(og).toContain("EMAIL_MASCOTA.height");
    // Ancho y alto con los que se dibuja (470 de alto): misma proporción que el PNG real, con 1 px de redondeo
    const alto = Number(og.match(/MASCOT_H = (\d+)/)?.[1]);
    expect(alto).toBeGreaterThan(0);
    const ancho = Math.round((alto * EMAIL_MASCOTA.width) / EMAIL_MASCOTA.height);
    expect(Math.abs(ancho - (png.w * alto) / png.h)).toBeLessThanOrEqual(2.5);
    // Las tres imágenes para compartir pasan por la misma función
    for (const ruta of [
      "app/(public)/opengraph-image.tsx",
      "app/(public)/opengraph-image-es/route.tsx",
      "app/(public-en)/opengraph-image-en/route.tsx",
    ]) {
      expect(readFileSync(join(WEB, ruta), "utf8"), ruta).toContain("brandOgImage");
    }
  });

  it("no queda una imagen de la mascota fuera de las poses y las caras declaradas", () => {
    // `app/` solo tiene el favicon (icon.png, favicon.ico y apple-icon.png) y no hay otra carpeta de mascota
    expect(existsSync(app("icon.svg"))).toBe(false);
    expect(existsSync(join(WEB, "public", "mascota-v1"))).toBe(false);
    expect(existsSync(join(WEB, "public", "afi"))).toBe(false);
  });
});

// Los PNG/ICO se copian a `app/` a mano (docs/beta/pasos-manuales-r27.md, «Favicon»). Hasta
// entonces se saltean; con la copia hecha corren solos.
describe.skipIf(!existsSync(app("icon.png")))("favicon con la cara (convención de Next)", () => {
  const igual = (a: string, b: string) => readFileSync(a).equals(readFileSync(b));

  it("app/icon.png es la cara de 192 px y ya no existe icon.svg", () => {
    expect(existsSync(app("icon.svg"))).toBe(false);
    expect(igual(app("icon.png"), pub("favicon/favicon-192.png"))).toBe(true);
  });

  it("app/favicon.ico y app/apple-icon.png son los de public/mascota/favicon", () => {
    expect(igual(app("favicon.ico"), pub("favicon/favicon.ico"))).toBe(true);
    expect(pngSize(app("apple-icon.png"))).toEqual({ w: 180, h: 180 });
    expect(igual(app("apple-icon.png"), pub("favicon/favicon-180.png"))).toBe(true);
  });
});
