import { Manrope, Sora } from "next/font/google";

/**
 * Tipografías de la marca (C7-1, manual M5). `next/font` las descarga en el build y las sirve desde
 * el mismo dominio: sin pedidos a Google en el navegador. Solo latin (cubre ñ, tildes, ¿ y ¡) y
 * `display: swap` para que el texto se vea con la fuente del sistema mientras carga.
 *
 * - Sora 300/700/800: logo (300 y 800) y títulos (700).
 * - Manrope 500/600/700: el texto de la app.
 *
 * Las variables (`--font-sora`, `--font-manrope`) van en `<html>` y las lee `globals.css`.
 */
export const sora = Sora({
  subsets: ["latin"],
  weight: ["300", "700", "800"],
  display: "swap",
  variable: "--font-sora",
});

export const manrope = Manrope({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  display: "swap",
  variable: "--font-manrope",
});
