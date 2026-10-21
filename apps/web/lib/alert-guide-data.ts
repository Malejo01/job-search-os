import type { AlertGuideProps } from "@/app/onboarding/asistente/alert-guide";
import { getProfileForEdit, getTargetRoles } from "./onboarding";
import { portalCoverage } from "./portal-coverage";

/** Carreras, idioma y estado de cada portal de la persona, para «Qué alertas crear». Solo lectura. */
export async function alertGuideData(userId: string): Promise<AlertGuideProps> {
  const [roles, profile, coverage] = await Promise.all([
    getTargetRoles(userId),
    getProfileForEdit(userId),
    portalCoverage(userId, new Date()),
  ]);
  return { roles, language: profile?.jobLanguage ?? "both", coverage };
}
