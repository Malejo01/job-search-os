import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { EMAIL_MASCOTA, MASCOTA_NOMBRE as NOMBRE_PIPELINE } from "@job-search-os/pipeline";
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
