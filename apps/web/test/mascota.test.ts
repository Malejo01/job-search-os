import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  dayKey,
  MASCOTA_DISPONIBLE,
  MASCOTA_IMAGENES,
  MASCOTA_POSES,
  mascotaSrc,
  shouldGreetToday,
} from "../lib/mascota";
import { MASCOT_NAME } from "../lib/textos-rediseno";

const WEB = join(__dirname, "..");
const read = (f: string) => readFileSync(join(WEB, f), "utf8");

describe("imágenes de la mascota", () => {
  it("las cinco poses y la cara de 48", () => {
    expect([...MASCOTA_POSES]).toEqual(["quieta", "hablando", "pensando", "saludo", "festejo"]);
    expect(MASCOTA_IMAGENES).toContain("cara-48");
  });

  it("la bandera de cada imagen coincide con los archivos (1x y 2x) de public/mascota", () => {
    for (const img of MASCOTA_IMAGENES) {
      const hay =
        existsSync(join(WEB, "public/mascota", `${img}.png`)) &&
        existsSync(join(WEB, "public/mascota", `${img}@2x.png`));
      expect(MASCOTA_DISPONIBLE[img], `${img}: pasá la bandera a ${hay} en lib/mascota.ts`).toBe(
        hay,
      );
    }
  });

  it("rutas 1x y 2x", () => {
    expect(mascotaSrc("quieta")).toEqual({
      src: "/mascota/quieta.png",
      srcSet: "/mascota/quieta.png 1x, /mascota/quieta@2x.png 2x",
    });
  });
});

describe("saludo una vez por día", () => {
  it("dayKey usa el día local con ceros", () => {
    expect(dayKey(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
    expect(dayKey(new Date(2026, 10, 22, 0, 1))).toBe("2026-11-22");
  });

  it("saluda si no hay registro o si es otro día; no si ya saludó hoy", () => {
    expect(shouldGreetToday(null, "2026-11-22")).toBe(true);
    expect(shouldGreetToday("2026-11-21", "2026-11-22")).toBe(true);
    expect(shouldGreetToday("2026-11-22", "2026-11-22")).toBe(false);
  });

  it("Hoy lo monta sin consultas: estado del navegador, no del servidor", () => {
    const c = read("app/(app)/hoy/mascota-saludo.tsx");
    expect(c).toContain('"use client"');
    expect(c).toContain("localStorage");
    expect(c).toContain('pose="saludo"');
    expect(c).not.toMatch(/fetch\(|withUser|"use server"/);
    expect(read("app/(app)/hoy/page.tsx")).toContain("<MascotaSaludo />");
  });
});

describe("componente y usos", () => {
  const comp = read("components/mascota.tsx");

  it("sin animación con «reducir movimiento»: la única animación va con motion-safe", () => {
    const animaciones = comp.match(/animate-[a-z]+/g) ?? [];
    expect(animaciones.length).toBeGreaterThan(0);
    for (const a of animaciones) expect(comp).toContain(`motion-safe:${a}`);
  });

  it("marcador del mismo tamaño que la imagen y sin HTML inyectado", () => {
    expect(comp).toContain("style={{ width: size, height: size }}");
    expect(comp).toContain('data-mascota-estado={ready ? "lista" : "marcador"}');
    expect(comp).not.toMatch(/dangerouslySetInnerHTML/);
  });

  it("el nombre sale de MASCOT_NAME y vale «Tu asistente» hasta que se elija", () => {
    expect(MASCOT_NAME).toBe("Tu asistente");
    expect(read("components/assistant-mascot.tsx")).toContain("title={MASCOT_NAME}");
  });

  it("el botón usa la cara-48, el panel «hablando» y «pensando», y los logros «festejo»", () => {
    expect(read("components/assistant-mascot.tsx")).toContain('pose="cara-48"');
    expect(read("app/(app)/assistant-panel.tsx")).toContain(
      'pose={pending ? "pensando" : "hablando"}',
    );
    expect(read("app/(app)/jobs/first-steps.tsx")).toContain('pose="festejo"');
  });
});
