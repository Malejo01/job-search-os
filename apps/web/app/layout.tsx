import { PRODUCT_NAME } from "@job-search-os/pipeline";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: PRODUCT_NAME,
  description:
    "Menos postulaciones, mejores. El modelo evalúa, el código decide, el humano interviene.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body className="min-h-screen bg-zinc-50 text-zinc-900 antialiased">{children}</body>
    </html>
  );
}
