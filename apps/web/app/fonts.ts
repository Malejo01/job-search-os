import localFont from "next/font/local";

/**
 * Tipografías de la marca (C7-1, manual M5). Se sirven desde el mismo dominio, sin pedidos a
 * Google ni en el navegador ni en el build: los archivos están en `apps/web/assets/fonts` (subset
 * latin de `@fontsource`, licencia OFL). Con `next/font/google` el build del CI falló al bajar las
 * fuentes; con archivos locales el build no depende de la red. Cubre ñ, tildes, ¿ y ¡.
 * `display: swap`: el texto se ve con la fuente del sistema mientras carga.
 *
 * - Sora 300/700/800: logo (300 y 800) y títulos (700).
 * - Manrope 500/600/700: el texto de la app.
 *
 * Las variables (`--font-sora`, `--font-manrope`) van en `<html>` y las lee `globals.css`.
 */
export const sora = localFont({
  src: [
    { path: "../assets/fonts/sora-300.woff2", weight: "300", style: "normal" },
    { path: "../assets/fonts/sora-700.woff2", weight: "700", style: "normal" },
    { path: "../assets/fonts/sora-800.woff2", weight: "800", style: "normal" },
  ],
  display: "swap",
  variable: "--font-sora",
  fallback: ["ui-sans-serif", "system-ui", "sans-serif"],
});

export const manrope = localFont({
  src: [
    { path: "../assets/fonts/manrope-500.woff2", weight: "500", style: "normal" },
    { path: "../assets/fonts/manrope-600.woff2", weight: "600", style: "normal" },
    { path: "../assets/fonts/manrope-700.woff2", weight: "700", style: "normal" },
  ],
  display: "swap",
  variable: "--font-manrope",
  fallback: ["ui-sans-serif", "system-ui", "sans-serif"],
});
