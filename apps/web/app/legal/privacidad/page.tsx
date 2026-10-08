import type { Metadata } from "next";
import { LegalPage } from "@/lib/legal";

export const metadata: Metadata = { title: "Política de privacidad (borrador)" };

// Pública y sin base: LegalPage lee el Markdown del disco y las variables LEGAL_* en cada request
// (dinámica), para que cambiarlas en Vercel no exija un rebuild con datos horneados.
export const dynamic = "force-dynamic";

export default function PrivacidadPage() {
  return <LegalPage name="privacidad" />;
}
