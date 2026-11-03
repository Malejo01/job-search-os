import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ILLUSTRATIONS, illustrationSrc, type IllustrationScene } from "./illustrations";

const DIR = join(__dirname, "../../../apps/web/public/ilustraciones");

describe("manifiesto de ilustraciones (C9-12)", () => {
  it("las ocho escenas del rediseño, con fondo índigo solo hoy y acceso", () => {
    expect(Object.keys(ILLUSTRATIONS).sort()).toEqual(
      [
        "acceso",
        "bienvenida",
        "cv",
        "error",
        "hoy",
        "postulaciones",
        "sin-descripcion",
        "vacio",
      ].sort(),
    );
    for (const [scene, info] of Object.entries(ILLUSTRATIONS)) {
      expect(info.background, scene).toBe(
        scene === "hoy" || scene === "acceso" ? "ink" : "lavanda",
      );
    }
  });

  it("cada escena marcada como disponible tiene sus dos archivos (1x y @2x)", () => {
    for (const [scene, info] of Object.entries(ILLUSTRATIONS)) {
      if (!info.available) continue;
      expect(existsSync(join(DIR, `${scene}.webp`)), `${scene}.webp`).toBe(true);
      expect(existsSync(join(DIR, `${scene}@2x.webp`)), `${scene}@2x.webp`).toBe(true);
    }
  });

  it("ningún archivo de la carpeta queda fuera del manifiesto ni marcado como faltante", () => {
    const files = existsSync(DIR) ? readdirSync(DIR).filter((f) => f.endsWith(".webp")) : [];
    for (const file of files) {
      const scene = file.replace(/(@2x)?\.webp$/, "") as IllustrationScene;
      expect(ILLUSTRATIONS[scene], file).toBeDefined();
      expect(ILLUSTRATIONS[scene].available, `${file}: marcá la escena como disponible`).toBe(true);
    }
  });

  it("rutas públicas de los dos tamaños", () => {
    expect(illustrationSrc("hoy")).toEqual({
      src: "/ilustraciones/hoy.webp",
      srcSet: "/ilustraciones/hoy.webp 1x, /ilustraciones/hoy@2x.webp 2x",
    });
  });
});
