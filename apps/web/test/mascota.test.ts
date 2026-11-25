import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  caraSrc,
  dayKey,
  MASCOTA_ALT,
  MASCOTA_ALTOS,
  MASCOTA_ANCHOS,
  MASCOTA_CARAS,
  MASCOTA_IMAGENES,
  MASCOTA_NOMBRE,
  MASCOTA_POSES,
  mascotaArchivos,
  MASCOTA_USOS,
  mascotaAncho,
  mascotaEmailPng,
  mascotaSizes,
  mascotaSrc,
  shouldGreetToday,
} from "../lib/mascota";
import { MASCOT_NAME } from "../lib/textos-rediseno";

const WEB = join(__dirname, "..");
const read = (f: string) => readFileSync(join(WEB, f), "utf8");

describe("poses de Afi", () => {
  it("las nueve poses reales", () => {
    expect([...MASCOTA_POSES]).toEqual([
      "saludando",
      "trabajando",
      "pensando",
      "explicando",
      "quieto",
      "hablando-1",
      "hablando-2",
      "motivacion",
      "analizando",
    ]);
  });

  it("cada pose tiene un uso y un alt descriptivo con el nombre", () => {
    expect(MASCOTA_NOMBRE).toBe("Afi");
    for (const pose of MASCOTA_POSES) {
      expect(MASCOTA_USOS[pose].length, pose).toBeGreaterThan(5);
      expect(MASCOTA_ALT[pose], pose).toContain(MASCOTA_NOMBRE);
      expect(MASCOTA_ALT[pose].length, pose).toBeGreaterThan(MASCOTA_NOMBRE.length + 8);
    }
  });

  it("srcSet por ancho con los tres WebP, sizes y ancho por proporción", () => {
    const { src, srcSet } = mascotaSrc("saludando");
    expect(src).toBe("/mascota/saludando-512.webp");
    expect(srcSet).toBe(
      "/mascota/saludando-256.webp 150w, /mascota/saludando-512.webp 301w, /mascota/saludando-1024.webp 602w",
    );
    expect(mascotaAncho("quieto", 100)).toBe(56);
    expect(mascotaSizes("quieto", 100)).toBe("56px");
  });

  it("PNG para emails y srcSet de la cara", () => {
    expect(mascotaEmailPng("saludando")).toBe("/mascota/saludando-512.png");
    expect(caraSrc().srcSet).toBe(
      "/mascota/cara-48.webp 48w, /mascota/cara-96.webp 96w, /mascota/cara-192.webp 192w, /mascota/cara-512.webp 512w",
    );
  });
});

describe("archivos reales de public/mascota", () => {
  const DIR = join(WEB, "public", "mascota");

  /** Ancho y alto de un WebP, leídos del encabezado (VP8X, VP8L o VP8), sin dependencias. */
  function webpSize(file: string): { w: number; h: number } {
    const b = readFileSync(file);
    expect(b.toString("ascii", 0, 4)).toBe("RIFF");
    expect(b.toString("ascii", 8, 12)).toBe("WEBP");
    const t = b.toString("ascii", 12, 16);
    if (t === "VP8X") return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
    if (t === "VP8L") {
      const v = b.readUInt32LE(21);
      return { w: (v & 0x3fff) + 1, h: ((v >> 14) & 0x3fff) + 1 };
    }
    return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
  }

  it("cada pose tiene sus 4 archivos y cada cara sus 2", () => {
    for (const img of MASCOTA_IMAGENES) {
      const archivos = mascotaArchivos(img);
      expect(archivos.length).toBe((MASCOTA_CARAS as readonly string[]).includes(img) ? 2 : 4);
      for (const f of archivos) expect(existsSync(join(DIR, f)), `falta ${f}`).toBe(true);
    }
  });

  it("los anchos declarados coinciden con los del archivo, y el alto es 256, 512 o 1024", () => {
    for (const pose of MASCOTA_POSES) {
      for (const alto of MASCOTA_ALTOS) {
        const { w, h } = webpSize(join(DIR, `${pose}-${alto}.webp`));
        expect(h, `${pose}-${alto}: alto`).toBe(alto);
        expect(w, `${pose}-${alto}: ancho declarado`).toBe(MASCOTA_ANCHOS[pose][alto]);
      }
    }
  });

  it("las caras son cuadradas del tamaño de su nombre", () => {
    for (const cara of MASCOTA_CARAS) {
      const lado = Number(cara.slice("cara-".length));
      expect(webpSize(join(DIR, `${cara}.webp`))).toEqual({ w: lado, h: lado });
    }
  });

  it("ningún archivo del primer nivel queda sin declarar (la carpeta favicon/ es de R27-06)", () => {
    const declarados = new Set(MASCOTA_IMAGENES.flatMap((i) => mascotaArchivos(i)));
    for (const nombre of readdirSync(DIR)) {
      if (statSync(join(DIR, nombre)).isDirectory()) continue; // favicon/
      expect(declarados.has(nombre), `${nombre} no está declarado en lib/mascota.ts`).toBe(true);
    }
  });
});

describe("el nombre sale de MASCOTA_NOMBRE", () => {
  /** Quita comentarios (crudo, solo para el barrido) */
  const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  /** «Afi» como palabra dentro de un texto: entre comillas o entre etiquetas, no como componente. */
  const ESCRITO_A_MANO = /(["'`>])[^"'`<>\n]*\bAfi\b(?![A-Za-z-])[^"'`<>\n]*(["'`<])/;

  function archivos(dir: string): string[] {
    return readdirSync(dir).flatMap((nombre) => {
      const ruta = join(dir, nombre);
      if (statSync(ruta).isDirectory()) return nombre === "node_modules" ? [] : archivos(ruta);
      return /\.(ts|tsx)$/.test(nombre) && !/\.test\.(ts|tsx)$/.test(nombre) ? [ruta] : [];
    });
  }

  it("el barrido detecta un nombre escrito a mano (control)", () => {
    expect(ESCRITO_A_MANO.test('const t = "Preguntale a Afi";')).toBe(true);
    expect(ESCRITO_A_MANO.test("<p>Afi está pensando</p>")).toBe(true);
    expect(ESCRITO_A_MANO.test('<Afi pose="quieto" size={44} />')).toBe(false);
    expect(ESCRITO_A_MANO.test('import { Afi } from "@/components/afi";')).toBe(false);
  });

  it("ningún archivo de app/ ni components/ lo escribe a mano", () => {
    const sospechosos: string[] = [];
    for (const raiz of ["app", "components"]) {
      for (const f of archivos(join(WEB, raiz))) {
        const codigo = sinComentarios(readFileSync(f, "utf8"));
        if (codigo.split("\n").some((l) => ESCRITO_A_MANO.test(l))) sospechosos.push(f);
      }
    }
    expect(sospechosos, "armá el texto con MASCOTA_NOMBRE").toEqual([]);
  });

  it("MASCOT_NAME vale MASCOTA_NOMBRE y el botón lo usa de título", () => {
    expect(MASCOT_NAME).toBe(MASCOTA_NOMBRE);
    expect(read("components/assistant-mascot.tsx")).toContain("title={MASCOT_NAME}");
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

  // El montaje del saludo en Hoy (cuenta + navegador) lo prueba R27-04 en su propio test.
});

describe("componente <Afi>", () => {
  const comp = read("components/afi.tsx");

  it("Server Component: sin hooks ni 'use client', img estática con medidas fijas", () => {
    expect(comp).not.toMatch(/"use client"|useState|useEffect|framer-motion|next\/image/);
    expect(comp).toContain("width={mascotaAncho(pose, size)}");
    expect(comp).toContain("height={size}");
    expect(comp).toContain("sizes={mascotaSizes(pose, size)}");
    expect(comp).toContain('loading={priority ? "eager" : "lazy"}');
    expect(comp).toContain('fetchPriority: "high"');
    expect(comp).toContain("data-afi={pose}");
    expect(comp).toContain("bg-illustration");
  });

  it("decorative: alt vacío y aria-hidden", () => {
    expect(comp).toContain('alt={decorative ? "" : MASCOTA_ALT[pose]}');
    expect(comp).toContain('"aria-hidden": true');
  });

  it("el botón usa la cara y el panel «pensando» / «hablando-1»; los logros «motivacion»", () => {
    expect(read("components/assistant-mascot.tsx")).toContain("<AfiCara");
    const panel = read("app/(app)/assistant-panel.tsx");
    expect(panel).toMatch(/pending\s*\?\s*"pensando"/);
    expect(panel).toContain('"hablando-1"');
    expect(panel).toContain("<AfiAnimado");
    expect(read("app/(app)/jobs/first-steps.tsx")).toContain('pose="motivacion"');
  });
});

describe("<AfiAnimado> (R27-02)", () => {
  const anim = read("components/afi-animado.tsx");
  const lazy = read("components/afi-animado-lazy.tsx");

  it("cliente, Framer liviano (LazyMotion + domAnimation + m) y fundido entre poses", () => {
    expect(anim).toContain('"use client"');
    expect(anim).toContain("LazyMotion features={domAnimation} strict");
    expect(anim).toContain("<m.span");
    expect(anim).not.toMatch(/\bmotion\./);
    expect(anim).toContain("AnimatePresence");
    expect(anim).toContain("key={pose}");
  });

  it("las cuatro variantes", () => {
    for (const v of ["entrada", "flotar", "festejo", "hover"]) expect(anim).toContain(`"${v}"`);
  });

  it("movimiento reducido: estático, sin Framer ni transform", () => {
    expect(anim).toContain("useReducedMotion()");
    const rama = anim.slice(anim.indexOf("if (reduce)"), anim.indexOf("return (\n    <LazyMotion"));
    expect(rama).toContain('data-movimiento="reducido"');
    expect(rama).not.toMatch(/<m\.|animate|initial|whileHover|transition/);
  });

  it("el cargador aparte no importa Framer ni el componente animado de forma estática", () => {
    expect(lazy).toContain('import("@/components/afi-animado")');
    expect(lazy).not.toMatch(/framer-motion/);
    expect(lazy).not.toMatch(/^import \{[^}]*AfiAnimado[^}]*\} from/m);
    expect(lazy).toContain("import type { AfiAnimadoProps }");
  });

  it("el botón del asistente no anima al pasar el mouse con el panel abierto", () => {
    expect(read("components/assistant-mascot.tsx")).toContain("reduce || open ? undefined");
  });
});
