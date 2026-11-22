/**
 * Precarga del formulario de onboarding con lo que la guía del agente dejó en el navegador: país y modalidades.
 * Es lo que usa el código de cliente. Es `profileAgentFormPrefill` sin el resumen: el resumen del agente no
 * pasa por el navegador (se precarga desde lo guardado, leído en el servidor), y el resumen es lo único que
 * necesitaba el detector de instrucciones. Sin imports a propósito: no puede arrastrar el detector al bundle.
 */
export interface OnboardingGuidePrefill {
  country?: string;
  acceptedModalities?: string[];
}

export function onboardingGuidePrefill(
  guide: { country?: string | undefined; modalities?: readonly string[] | undefined } | null,
  current: { country: string },
): OnboardingGuidePrefill {
  const out: OnboardingGuidePrefill = {};
  if (guide?.country && current.country === "") out.country = guide.country;
  if (guide?.modalities && guide.modalities.length > 0) out.acceptedModalities = [...guide.modalities];
  return out;
}
