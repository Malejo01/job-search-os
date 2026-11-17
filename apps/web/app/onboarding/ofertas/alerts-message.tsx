import { createLogger } from "@job-search-os/adapters";
import { careersWithFewOffers, nudgeCopy, type CareerVolume } from "@job-search-os/pipeline";
import { EmailNudge } from "@/app/components/email-nudge";
import { careerLabel, getCareerMarket } from "@/lib/career-market";
import { getProfileForEdit, getTargetRoles } from "@/lib/onboarding";

/**
 * El único mensaje entre el cierre del onboarding y la guía de alertas (R11-10). Nombra los mismos
 * portales que la guía (`nudgeCopy` y la guía salen de `portalGroupsForRoles`) y, si alguna de las
 * carreras tiene menos de 5 ofertas en el idioma de la persona esta semana, lo dice en el mismo
 * mensaje y suma el camino de cargar una oferta. Si no se puede leer el mercado, queda el mensaje
 * de siempre: el aviso nunca rompe la página.
 */
export async function AlertsMessage({ userId }: { userId: string }) {
  const [roles, profile] = await Promise.all([getTargetRoles(userId), getProfileForEdit(userId)]);
  const language = profile?.jobLanguage ?? "both";

  let few: string[] = [];
  try {
    const volumes: (CareerVolume & { label: string })[] = await Promise.all(
      roles.map(async (role) => {
        const { total, writtenInSpanish } = (await getCareerMarket(role)).volume.last7d;
        return { role, total, writtenInSpanish, label: careerLabel(role) };
      }),
    );
    const flagged = new Set(careersWithFewOffers(volumes, language).map((c) => c.role));
    few = volumes.filter((v) => flagged.has(v.role)).map((v) => v.label);
  } catch (err) {
    // Solo el tipo de error: el mensaje puede traer parámetros de la consulta
    const errName = err instanceof Error ? err.name : "desconocido";
    createLogger({ user_id: userId, task: "onboarding_alertas" }).warn(
      { errName },
      "no se pudo leer el volumen de ofertas",
    );
  }

  const copy = nudgeCopy({ roles, language, few });
  return (
    <EmailNudge
      userId={userId}
      title={copy.title}
      body={copy.body}
      cta={copy.cta}
      href="/onboarding/asistente"
      secondary={copy.secondary ?? undefined}
    />
  );
}
