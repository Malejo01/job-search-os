import type { Metadata } from "next";
import { LegalPage } from "@/lib/legal";

// El layout de (app) consulta la base (sesión y rol): sin esto Next la prerenderiza en el build,
// donde no hay DATABASE_URL (CI y Vercel).
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Términos de uso (borrador)" };

export default function TerminosPage() {
  return <LegalPage name="terminos" />;
}
