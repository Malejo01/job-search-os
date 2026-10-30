import { PRODUCT_NAME } from "@job-search-os/pipeline";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { ThemeScript } from "./theme-script";

export const metadata: Metadata = {
  title: { default: PRODUCT_NAME, template: `%s · ${PRODUCT_NAME}` },
  description:
    "Menos postulaciones, mejores. El modelo evalúa, el código decide, el humano interviene.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // suppressHydrationWarning: ThemeScript pone la clase `dark` en <html> antes de hidratar
    <html lang="es" suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body className="min-h-screen bg-canvas text-fg antialiased">{children}</body>
    </html>
  );
}
