import localFont from "next/font/local";

/**
 * Tipografías de la marca (C9-2, decisión 3 de `decisiones-c9.md`, en la carpeta del rediseño).
 * Se sirven desde el mismo dominio, sin pedidos a Google ni en el navegador ni en el build: los
 * archivos están en `apps/web/assets/fonts` (subset latin de `@fontsource` 5.3.0, licencia OFL).
 * La decisión pedía `next/font/google`; en C7-1 el build del CI falló al bajar las fuentes de
 * Google, así que se usan los mismos archivos con `next/font/local` (mismo resultado en pantalla,
 * sin depender de la red). Cubre ñ, tildes, ¿ y ¡. `display: swap`: el texto se ve con la
 * fuente del sistema mientras carga.
 *
 * - Bricolage Grotesque 500/700/800: títulos (700), el sello (800) y el logotipo («AfinIA» 800,
 *   «Jobs» 500).
 * - Figtree 500/600/700/800: el texto (500 y 600) y los botones (700 y 800).
 *
 * Las variables (`--font-bricolage`, `--font-figtree`) van en `<html>` y las lee `globals.css`.
 */
export const bricolage = localFont({
  src: [
    { path: "../assets/fonts/bricolage-500.woff2", weight: "500", style: "normal" },
    { path: "../assets/fonts/bricolage-700.woff2", weight: "700", style: "normal" },
    { path: "../assets/fonts/bricolage-800.woff2", weight: "800", style: "normal" },
  ],
  display: "swap",
  variable: "--font-bricolage",
  fallback: ["ui-sans-serif", "system-ui", "sans-serif"],
});

export const figtree = localFont({
  src: [
    { path: "../assets/fonts/figtree-500.woff2", weight: "500", style: "normal" },
    { path: "../assets/fonts/figtree-600.woff2", weight: "600", style: "normal" },
    { path: "../assets/fonts/figtree-700.woff2", weight: "700", style: "normal" },
    { path: "../assets/fonts/figtree-800.woff2", weight: "800", style: "normal" },
  ],
  display: "swap",
  variable: "--font-figtree",
  fallback: ["ui-sans-serif", "system-ui", "sans-serif"],
});
