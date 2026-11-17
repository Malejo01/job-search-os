import { CV_COACH_PAGES } from "@job-search-os/pipeline";
import Link from "next/link";
import { buttonClasses, cardClasses } from "@/components/ui";
import { cvCoachAllowedFor } from "@/lib/cv-coach/access";
import { catalogLabel } from "@/lib/career-names";
import { getTargetRoles } from "@/lib/onboarding";

/**
 * Entrada al coach de CV (ADR-038, R12-10): «Mejorar mi CV para {puesto}». Server Component; sin el flag
 * `CV_COACH` (o sin el agente de perfil) no pinta nada. El coach usa el ticket de la lectura del agente de
 * perfil, que vive en la pestaña: por eso la entrada está en una pantalla del agente.
 */
export async function CvCoachEntry({ userId }: { userId: string }) {
  if (!(await cvCoachAllowedFor(userId))) return null;
  const [role] = await getTargetRoles(userId);
  const target = role ? catalogLabel(role) : "tu próximo trabajo";
  return (
    <section
      className={cardClasses({ padding: "md", className: "no-print flex flex-col gap-2" })}
      data-testid="coach-entry"
    >
      <p className="text-sm text-fg-muted">
        Antes de armarlo, podemos revisar tu CV contra lo que piden los avisos y preguntarte lo que
        falta.
      </p>
      <Link href={CV_COACH_PAGES.diagnosis} className={buttonClasses({ className: "self-start" })}>
        Mejorar mi CV para {target}
      </Link>
    </section>
  );
}
