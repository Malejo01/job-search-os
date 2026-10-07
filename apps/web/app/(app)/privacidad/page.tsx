import type { Metadata } from "next";
import { LegalPage } from "@/lib/legal";

export const metadata: Metadata = { title: "Política de privacidad (borrador)" };

export default function PrivacidadPage() {
  return <LegalPage name="privacidad" />;
}
