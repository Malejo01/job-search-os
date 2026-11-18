import { notFound } from "next/navigation";
import { CvCoachDiagnosis } from "@/components/cv-coach/diagnosis";
import { cvCoachAllowedFor } from "@/lib/cv-coach/access";
import { requireActiveUserId } from "@/lib/session";

export const metadata = { title: "Mejorá tu CV" };
export const dynamic = "force-dynamic";

/**
 * Diagnóstico del coach de CV (ADR-038 §4, R12-10). Server Component: con el flag apagado responde 404 como
 * cualquier ruta que no existe. El diagnóstico vive en el componente de cliente y no se guarda: la lista
 * firmada viaja por el navegador y solo queda lo que la persona confirma después, en la charla.
 */
export default async function CvCoachPage() {
  const userId = await requireActiveUserId();
  if (!(await cvCoachAllowedFor(userId))) notFound();
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <h1 className="text-title font-bold">Mejorá tu CV</h1>
      <CvCoachDiagnosis />
    </div>
  );
}
