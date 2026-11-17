import { profileAgentNextSteps, type CvDiffItem } from "@job-search-os/pipeline";
import { notFound } from "next/navigation";
import { CvCoachImproved } from "@/components/cv-coach/improved";
import { ProfileAgentClose } from "@/components/profile-agent/close";
import { cvCoachAllowedFor } from "@/lib/cv-coach/access";
import { loadCvCoachContext } from "@/lib/cv-coach/context";
import { requireActiveUserId } from "@/lib/session";

export const metadata = { title: "Tu CV mejorado" };
export const dynamic = "force-dynamic";
// El cierre llama al modelo (redacción del CV): el límite de la ruta de la API es el que manda
export const maxDuration = 60;

/**
 * Cierre del coach de CV (ADR-038, R12-11): «Qué mejoró» y el CV ATS. Server Component: con el flag apagado,
 * 404. Lo de hoy se lee acá con RLS y se pasa a la vista; la foto «antes», la lista y el avance están en el
 * navegador. El CV sale del cierre de ADR-034 (`/api/cv-perfil/cierre`: `cv_write` y el verificador), con el
 * mismo ticket de la charla.
 */
export default async function CvCoachDonePage() {
  const userId = await requireActiveUserId();
  if (!(await cvCoachAllowedFor(userId))) notFound();
  const { ctx } = await loadCvCoachContext(userId);
  const after: CvDiffItem[] = ctx.items.map((i) => ({
    historyId: i.id,
    kind: i.kind,
    organization: i.organization,
    title: i.title,
    bullets: i.bullets.slice(0, 6),
  }));
  // Solo los nombres que pueden aparecer en una brecha: las skills del mercado del puesto y las de la persona
  const wanted = new Set([...ctx.demand.map((d) => d.slug), ...ctx.personSkills]);
  const skills = ctx.taxonomy
    .filter((t) => wanted.has(t.slug))
    .map((t) => ({ slug: t.slug, name: t.name }));
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <h1 className="no-print text-title font-bold">Tu CV mejorado</h1>
      <CvCoachImproved after={after} target={ctx.target} skills={skills} />
      <ProfileAgentClose base="app" nextSteps={profileAgentNextSteps("app")} />
    </div>
  );
}
