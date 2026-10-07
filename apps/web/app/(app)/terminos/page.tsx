import type { Metadata } from "next";
import { LegalPage } from "@/lib/legal";

export const metadata: Metadata = { title: "Términos de uso (borrador)" };

export default function TerminosPage() {
  return <LegalPage name="terminos" />;
}
