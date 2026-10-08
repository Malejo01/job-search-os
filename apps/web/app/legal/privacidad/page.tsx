import type { Metadata } from "next";
import { LegalPage } from "@/lib/legal";

export const metadata: Metadata = { title: "Política de privacidad (borrador)" };

// Pública y sin base: LegalPage lee el Markdown del disco y la página se prerenderiza en el build.
export default function PrivacidadPage() {
  return <LegalPage name="privacidad" />;
}
