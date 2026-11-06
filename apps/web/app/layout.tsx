import { BRAND, BRAND_COLORS } from "@job-search-os/pipeline";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { ThemeSync } from "@/components/theme-sync";
import { bricolage, figtree } from "./fonts";
import "./globals.css";
import { ThemeScript } from "./theme-script";

export const metadata: Metadata = {
  title: { default: BRAND.name, template: `%s · ${BRAND.name}` },
  applicationName: BRAND.name,
  description: `${BRAND.tagline} Leemos cada oferta contra tu perfil y vos decidís.`,
};

// Color de la barra del navegador en el celular: tinta, como el header (C7-2)
export const viewport: Viewport = { themeColor: BRAND_COLORS.ink };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // suppressHydrationWarning: ThemeScript pone la clase `dark` en <html> antes de hidratar
    <html
      lang="es"
      suppressHydrationWarning
      className={`${bricolage.variable} ${figtree.variable}`}
    >
      <head>
        <ThemeScript />
      </head>
      <body className="min-h-screen bg-canvas font-sans text-fg antialiased">
        <ThemeSync />
        {children}
      </body>
    </html>
  );
}
